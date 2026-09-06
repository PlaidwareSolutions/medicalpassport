import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import type { ProfileAction } from "@medpass/authorization";
import { CAREGIVER_ALERT_WINDOW_DAYS, ERROR_CODES, addDaysToDateString, dateStringInTz, zonedTimeToInstant, type CaregiverScope } from "@medpass/domain";
import { getObservationConcept } from "@medpass/terminology";
import type { ActivityQuery } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";
import { ProfileAccessService } from "../../common/profile-access.service";
import { computeProfileRelationships, type ProfileRelationship } from "../../common/profile-relationship";

export interface FamilyProfileSummary {
  /** Upcoming doses due today in the profile's own zone; null without `view_schedule`. */
  dueDosesToday: number | null;
  /** Missed doses inside the caregiver-alert window; null without `manage_reminders`. */
  openAlerts: number | null;
  /** The most recent Observation of any concept; null without `view_measurements` (or none recorded). */
  lastMeasurement: { concept: string; label: string; value: string; value2: string | null; unit: string; measuredAt: string } | null;
  /** Placeholder until TestDueSchedule ships (docs_v2/04 §12) — always null for now. */
  nextTestDue: null;
}

export interface FamilyProfileDto {
  id: string;
  displayName: string;
  relationship: ProfileRelationship;
  /** Active caregiver scopes on this profile; empty for self/dependent (the caller is the patient). */
  scopes: CaregiverScope[];
  summary: FamilyProfileSummary;
}

export interface ActivityItemDto {
  id: string;
  source: "health_event" | "audit";
  occurredAt: string;
  kind: string | null;
  action: string | null;
  entityType: string | null;
  entityId: string | null;
  summary: unknown;
  actor: { actorType: string; relationship: string | null; label: string | null; relationshipId: string | null };
}

/**
 * Audit actions a caregiver produces just by looking. "Who changed what" is
 * about changes; reads are the caregiver access log's business
 * (`GET caregivers/:id/accesses`).
 */
const READ_ONLY_AUDIT_ACTIONS = ["caregiver.access_used", "caregiver.family_viewed", "profile.viewed_by_caregiver", "finding.viewed"];

/** Opaque keyset cursor shared across both sources: base64url of `occurredAt|id`, newest first. */
function encodeCursor(occurredAt: Date, id: string): string {
  return Buffer.from(`${occurredAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { occurredAt: Date; id: string } {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const sep = decoded.indexOf("|");
  const occurredAt = sep > 0 ? new Date(decoded.slice(0, sep)) : new Date(NaN);
  const id = sep > 0 ? decoded.slice(sep + 1) : "";
  if (Number.isNaN(occurredAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Invalid cursor", 400);
  }
  return { occurredAt, id };
}

/**
 * Family dashboard and activity feed (docs_v2/05 §8, docs_v2/06 P6-3).
 *
 * The dashboard is the one read that spans profiles, so it cannot go
 * through `ProfileAccessService.require()` (one `x-profile-id` per
 * request). It asks the same pure decider per profile and per field
 * instead: a caregiver with `view_medications` alone sees the profile and
 * its name, but every summary number their scopes do not grant is null
 * rather than absent — the client can tell "nothing due" from "not yours to
 * see". Every caregiver-side profile read is audited exactly like a
 * `require()` call would be (docs/18).
 */
@Injectable()
export class FamilyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProfileAccessService,
  ) {}

  async dashboard(userId: string, correlationId?: string): Promise<FamilyProfileDto[]> {
    const now = new Date();
    const profiles = await this.prisma.patientProfile.findMany({
      where: {
        deletedAt: null,
        OR: [
          { ownerUserId: userId },
          { claimedByUserId: userId },
          { caregiverRelationships: { some: { caregiverUserId: userId, status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } } },
        ],
      },
      include: {
        caregiverRelationships: {
          where: { caregiverUserId: userId, status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          include: { permissions: { where: { revokedAt: null }, select: { scope: true } } },
          take: 1,
        },
      },
      orderBy: { createdAt: "asc" },
    });
    const relationships = computeProfileRelationships(profiles, userId);

    return Promise.all(
      profiles.map(async (p) => {
        const relationship = relationships.get(p.id)!;
        const caregiverRelationship = relationship === "caregiver" ? p.caregiverRelationships[0] : undefined;
        const scopes = caregiverRelationship?.permissions.map((x) => x.scope) ?? [];
        const ctx = { userId, profileOwnerUserId: p.ownerUserId, profileClaimedByUserId: p.claimedByUserId, caregiverScopes: scopes };
        const may = (action: ProfileAction) => this.access.decide(ctx, action);

        if (caregiverRelationship) {
          await writeAudit(this.prisma, {
            action: "caregiver.family_viewed",
            actorUserId: userId,
            actorType: "caregiver",
            entityType: "caregiver_relationship",
            entityId: caregiverRelationship.id,
            patientProfileId: p.id,
            correlationId,
          });
        }

        const [dueDosesToday, openAlerts, lastMeasurement] = await Promise.all([
          may("view_schedule") ? this.dueDosesToday(p.id, p.timezone, now) : null,
          may("manage_reminders") ? this.openAlerts(p.id, now) : null,
          may("view_measurements") ? this.lastMeasurement(p.id) : null,
        ]);

        return {
          id: p.id,
          displayName: p.displayName,
          relationship,
          scopes,
          summary: { dueDosesToday, openAlerts, lastMeasurement, nextTestDue: null },
        };
      }),
    );
  }

  private async dueDosesToday(profileId: string, timezone: string, now: Date): Promise<number> {
    const dateStr = dateStringInTz(timezone, now);
    const dayStart = zonedTimeToInstant(timezone, dateStr, "00:00");
    const dayEnd = zonedTimeToInstant(timezone, addDaysToDateString(dateStr, 1), "00:00");
    return this.prisma.scheduledDose.count({
      where: {
        status: "upcoming",
        dueAt: { gte: dayStart, lt: dayEnd },
        medicationSchedule: { status: "active", patientMedication: { patientProfileId: profileId, deletedAt: null, status: "current" } },
      },
    });
  }

  /** Same window as `listCaregiverAlerts` / `hasOpenAlerts`, so a count here always has a list behind it. */
  private async openAlerts(profileId: string, now: Date): Promise<number> {
    const windowStart = new Date(now.getTime() - CAREGIVER_ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    return this.prisma.scheduledDose.count({
      where: {
        status: "missed",
        dueAt: { gte: windowStart },
        medicationSchedule: { patientMedication: { patientProfileId: profileId, deletedAt: null } },
      },
    });
  }

  private async lastMeasurement(profileId: string): Promise<FamilyProfileSummary["lastMeasurement"]> {
    const row = await this.prisma.observation.findFirst({
      where: { patientProfileId: profileId, deletedAt: null },
      orderBy: { measuredAt: "desc" },
      select: { concept: true, valueNumeric: true, valueNumeric2: true, valueText: true, unit: true, measuredAt: true },
    });
    if (!row) return null;
    return {
      concept: row.concept,
      label: getObservationConcept(row.concept)?.display ?? row.concept,
      value: row.valueNumeric?.toString() ?? row.valueText ?? "",
      value2: row.valueNumeric2?.toString() ?? null,
      unit: row.unit,
      measuredAt: row.measuredAt.toISOString(),
    };
  }

  /**
   * "Who changed what" (docs_v2/05 §8): HealthEvents and audit rows on this
   * profile where the actor was a caregiver, merged newest-first under one
   * `(occurredAt, id)` keyset so a page never repeats or skips a row across
   * the two sources. Read-only audit actions are left out — they belong to
   * the per-relationship access log.
   */
  async activity(profileId: string, query: ActivityQuery): Promise<{ items: ActivityItemDto[]; nextCursor: string | null }> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const before = cursor ? { OR: [{ occurredAt: { lt: cursor.occurredAt } }, { occurredAt: cursor.occurredAt, id: { lt: cursor.id } }] } : {};
    const take = query.limit + 1;

    const [events, audits] = await Promise.all([
      this.prisma.healthEvent.findMany({
        where: { patientProfileId: profileId, actorType: "caregiver", ...before },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take,
      }),
      this.prisma.auditEvent.findMany({
        where: { patientProfileId: profileId, actorType: "caregiver", action: { notIn: READ_ONLY_AUDIT_ACTIONS }, ...before },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take,
      }),
    ]);

    const merged: Array<{ occurredAt: Date; id: string; actorUserId: string | null; item: Omit<ActivityItemDto, "actor"> }> = [
      ...events.map((e) => ({
        occurredAt: e.occurredAt,
        id: e.id,
        actorUserId: e.actorUserId,
        item: {
          id: e.id,
          source: "health_event" as const,
          occurredAt: e.occurredAt.toISOString(),
          kind: e.kind,
          action: null,
          entityType: e.entityType,
          entityId: e.entityId,
          summary: e.summary,
        },
      })),
      ...audits.map((a) => ({
        occurredAt: a.occurredAt,
        id: a.id,
        actorUserId: a.actorUserId,
        item: {
          id: a.id,
          source: "audit" as const,
          occurredAt: a.occurredAt.toISOString(),
          kind: null,
          action: a.action,
          entityType: a.entityType,
          entityId: a.entityId,
          summary: a.context,
        },
      })),
    ].sort((x, y) => y.occurredAt.getTime() - x.occurredAt.getTime() || (y.id > x.id ? 1 : y.id < x.id ? -1 : 0));

    const hasMore = merged.length > query.limit;
    const page = hasMore ? merged.slice(0, query.limit) : merged;

    // Who: the relationship the patient labelled, never the caregiver's own account details.
    const actorIds = [...new Set(page.map((m) => m.actorUserId).filter((id): id is string => !!id))];
    const relationships = actorIds.length
      ? await this.prisma.caregiverRelationship.findMany({
          where: { patientProfileId: profileId, caregiverUserId: { in: actorIds } },
          orderBy: { createdAt: "desc" },
          select: { id: true, caregiverUserId: true, relationship: true, label: true },
        })
      : [];
    const byUser = new Map<string, (typeof relationships)[number]>();
    for (const r of relationships) if (r.caregiverUserId && !byUser.has(r.caregiverUserId)) byUser.set(r.caregiverUserId, r);

    const last = page[page.length - 1];
    return {
      items: page.map((m) => {
        const rel = m.actorUserId ? byUser.get(m.actorUserId) : undefined;
        return {
          ...m.item,
          actor: {
            actorType: "caregiver",
            relationship: rel?.relationship ?? null,
            label: rel?.label ?? null,
            relationshipId: rel?.id ?? null,
          },
        };
      }),
      nextCursor: hasMore && last ? encodeCursor(last.occurredAt, last.id) : null,
    };
  }
}

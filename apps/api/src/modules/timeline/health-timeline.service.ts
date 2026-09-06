import { Injectable } from "@nestjs/common";
import { ERROR_CODES, type HealthEventKind } from "@medpass/domain";
import type { Prisma } from "@medpass/database";
import type { HealthTimelineQuery } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";

/** Wire shape of one timeline entry (docs_v2/05 §3). */
export interface HealthEventDto {
  id: string;
  kind: string;
  occurredAt: string;
  occurredAtLocal: string | null;
  entityType: string;
  entityId: string;
  summary: unknown;
  encounterId: string | null;
  actorType: string;
  provenanceSource: string | null;
  verification: string | null;
  supersededAt: string | null;
}

export interface HealthTimelinePage {
  items: HealthEventDto[];
  nextCursor: string | null;
}

/** Opaque keyset cursor: base64url of `occurredAt|id`, newest first. */
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
 * The unified health timeline (ADR-V2-008): reads the one indexed
 * `health_events` projection, never the fifteen source tables. Dose-level
 * events are not projected (volume) — the day view still reads `DoseEvent`
 * through `GET profiles/current/timeline`.
 */
@Injectable()
export class HealthTimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async page(profileId: string, query: HealthTimelineQuery): Promise<HealthTimelinePage> {
    const where: Prisma.HealthEventWhereInput = {
      patientProfileId: profileId,
      ...(query.includeSuperseded ? {} : { supersededAt: null }),
      ...(query.kinds ? { kind: { in: query.kinds } } : {}),
    };
    const occurredAt: Prisma.DateTimeFilter = {};
    if (query.from) occurredAt.gte = query.from;
    if (query.to) occurredAt.lte = query.to;
    if (query.from || query.to) where.occurredAt = occurredAt;

    if (query.cursor) {
      const c = decodeCursor(query.cursor);
      where.AND = [
        { OR: [{ occurredAt: { lt: c.occurredAt } }, { occurredAt: c.occurredAt, id: { lt: c.id } }] },
      ];
    }

    const rows = await this.prisma.healthEvent.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map((e) => ({
        id: e.id,
        kind: e.kind,
        occurredAt: e.occurredAt.toISOString(),
        occurredAtLocal: e.occurredAtLocal,
        entityType: e.entityType,
        entityId: e.entityId,
        summary: e.summary,
        encounterId: e.encounterId,
        actorType: e.actorType,
        provenanceSource: e.provenanceSource,
        verification: e.verification,
        supersededAt: e.supersededAt?.toISOString() ?? null,
      })),
      nextCursor: hasMore && last ? encodeCursor(last.occurredAt, last.id) : null,
    };
  }

  /**
   * Home-card numbers. Per-kind counts come from live events; the headline
   * figures come from the source tables so they can never drift from what
   * the medicines/prescriptions/tests screens themselves show.
   */
  async summary(profileId: string) {
    const [byKind, lastEvent, activeMedicines, prescriptions, tests, glucose, bp, weight, documents] = await Promise.all([
      this.prisma.healthEvent.groupBy({
        by: ["kind"],
        where: { patientProfileId: profileId, supersededAt: null },
        _count: { _all: true },
      }),
      this.prisma.healthEvent.findFirst({
        where: { patientProfileId: profileId, supersededAt: null },
        orderBy: { occurredAt: "desc" },
        select: { occurredAt: true },
      }),
      this.prisma.patientMedication.count({ where: { patientProfileId: profileId, deletedAt: null, status: "current" } }),
      this.prisma.prescription.count({ where: { patientProfileId: profileId, deletedAt: null } }),
      this.prisma.medicalReport.count({ where: { patientProfileId: profileId, deletedAt: null } }),
      this.prisma.glucoseReading.count({ where: { patientProfileId: profileId, deletedAt: null } }),
      this.prisma.bloodPressureReading.count({ where: { patientProfileId: profileId, deletedAt: null } }),
      this.prisma.weightReading.count({ where: { patientProfileId: profileId, deletedAt: null } }),
      this.prisma.prescriptionDocument.count({ where: { patientProfileId: profileId, status: { not: "deleted" } } }),
    ]);
    const counts: Partial<Record<HealthEventKind, number>> = {};
    for (const row of byKind) counts[row.kind as HealthEventKind] = row._count._all;
    return {
      counts,
      medicines: { active: activeMedicines },
      prescriptions,
      tests,
      measurements: glucose + bp + weight,
      documents,
      lastEventAt: lastEvent?.occurredAt.toISOString() ?? null,
    };
  }
}

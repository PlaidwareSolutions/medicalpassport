import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES, addDaysToDateString, dateStringInTz, type AuditActorType } from "@medpass/domain";
import type { Prisma, TestDueSchedule } from "@medpass/database";
import type { CreateTestDueInput, UpdateTestDueInput } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";

interface Actor {
  userId: string;
  actorRole: "patient" | "caregiver";
  correlationId?: string;
}

type Db = PrismaService | Prisma.TransactionClient;

/** `@db.Date` round-trips as UTC midnight; the calendar date is the first ten ISO characters. */
function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function toDbDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

/**
 * The calendar date of the latest matching DiagnosticReport — by analyte
 * (any result row with that `analyteKey`) or by report kind. Mirrors
 * apps/cron/src/lib/test-due.ts `latestMatchingResultDate` exactly, so the
 * "last done" the patient sees is the same fact the reminder cron acts on.
 */
export async function latestMatchingResultDate(
  db: Db,
  profileId: string,
  target: { analyteKey: string | null; diagnosticKind: string | null },
): Promise<string | null> {
  const where: Prisma.DiagnosticReportWhereInput = {
    patientProfileId: profileId,
    deletedAt: null,
    status: { not: "cancelled" },
    ...(target.analyteKey ? { results: { some: { analyteKey: target.analyteKey, deletedAt: null } } } : {}),
    ...(target.diagnosticKind ? { kind: target.diagnosticKind as never } : {}),
  };
  const reports = await db.diagnosticReport.findMany({
    where,
    select: { testedAt: true, reportedAt: true, createdAt: true },
    orderBy: [{ testedAt: "desc" }, { reportedAt: "desc" }, { createdAt: "desc" }],
    take: 25,
  });
  let latest: string | null = null;
  for (const r of reports) {
    const when = r.testedAt ? dateOnly(r.testedAt) : r.reportedAt ? dateOnly(r.reportedAt) : dateOnly(r.createdAt);
    if (latest === null || when > latest) latest = when;
  }
  return latest;
}

/**
 * Test-due schedules (docs_v2/05 §12 P17): "Next test: HbA1c Nov 20".
 * Patient-owned reminders about WHEN a test is due — never a clinical
 * recommendation (the interval is whatever the patient or their clinician
 * typed in). Reads need `view_tests`, writes `upload_tests`, exactly the
 * pair diagnostics uses, so a caregiver who may file a report may also
 * plan the next one.
 */
@Injectable()
export class TestDueService {
  constructor(private readonly prisma: PrismaService) {}

  private async present(row: TestDueSchedule) {
    const lastDoneOn = await latestMatchingResultDate(this.prisma, row.patientProfileId, row);
    return {
      id: row.id,
      label: row.label,
      analyteKey: row.analyteKey,
      diagnosticKind: row.diagnosticKind,
      nextDueOn: dateOnly(row.dueOn),
      intervalDays: row.recurrenceDays,
      status: row.status,
      lastDoneOn,
      sourcePrescriptionId: row.sourcePrescriptionId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(profileId: string) {
    const rows = await this.prisma.testDueSchedule.findMany({
      where: { patientProfileId: profileId, deletedAt: null },
      orderBy: [{ dueOn: "asc" }, { createdAt: "asc" }],
    });
    return { items: await Promise.all(rows.map((r) => this.present(r))) };
  }

  async byId(profileId: string, id: string) {
    const row = await this.prisma.testDueSchedule.findFirst({ where: { id, patientProfileId: profileId, deletedAt: null } });
    if (!row) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Schedule not found", 404);
    return this.present(row);
  }

  /**
   * `nextDueOn` wins when given; otherwise the interval is anchored on the
   * latest matching result, or on today (in the profile's zone) when there
   * is none — "every 90 days from now".
   */
  async create(profileId: string, input: CreateTestDueInput, actor: Actor) {
    const profile = await this.prisma.patientProfile.findUniqueOrThrow({ where: { id: profileId }, select: { timezone: true } });
    const target = { analyteKey: input.analyteKey ?? null, diagnosticKind: input.diagnosticKind ?? null };
    let dueOn = input.nextDueOn;
    if (!dueOn) {
      const anchor = (await latestMatchingResultDate(this.prisma, profileId, target)) ?? dateStringInTz(profile.timezone);
      dueOn = addDaysToDateString(anchor, input.intervalDays!);
    }
    if (input.sourcePrescriptionId) {
      const rx = await this.prisma.prescription.findFirst({ where: { id: input.sourcePrescriptionId, patientProfileId: profileId, deletedAt: null }, select: { id: true } });
      if (!rx) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Prescription not found", 404);
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.testDueSchedule.create({
        data: {
          patientProfileId: profileId,
          ...target,
          label: input.label,
          dueOn: toDbDate(dueOn!),
          recurrenceDays: input.intervalDays ?? null,
          sourcePrescriptionId: input.sourcePrescriptionId ?? null,
          status: "pending",
          recordedByUserId: actor.userId,
        },
      });
      await writeAudit(tx, {
        action: "test_due.created",
        actorUserId: actor.userId,
        actorType: actor.actorRole as AuditActorType,
        entityType: "test_due_schedule",
        entityId: created.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        // Coarse: which kind of target and whether it recurs — never the label.
        context: { target: target.analyteKey ? "analyte" : "kind", recurring: input.intervalDays !== undefined },
      });
      return created;
    });
    return this.present(row);
  }

  async update(profileId: string, id: string, input: UpdateTestDueInput, actor: Actor) {
    const existing = await this.prisma.testDueSchedule.findFirst({ where: { id, patientProfileId: profileId, deletedAt: null } });
    if (!existing) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Schedule not found", 404);

    const data: Prisma.TestDueScheduleUpdateInput = {};
    if (input.label !== undefined) data.label = input.label;
    if (input.intervalDays !== undefined) data.recurrenceDays = input.intervalDays;
    if (input.nextDueOn !== undefined) data.dueOn = toDbDate(input.nextDueOn);
    if (input.status !== undefined) data.status = input.status;
    // Re-arming a notified/done/dismissed schedule with only a new date means "pending" again.
    if (input.nextDueOn !== undefined && input.status === undefined && existing.status !== "pending") data.status = "pending";

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.testDueSchedule.update({ where: { id }, data });
      await writeAudit(tx, {
        action: "test_due.updated",
        actorUserId: actor.userId,
        actorType: actor.actorRole as AuditActorType,
        entityType: "test_due_schedule",
        entityId: id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { fields: Object.keys(input), status: updated.status },
      });
      return updated;
    });
    return this.present(row);
  }

  async softDelete(profileId: string, id: string, actor: Actor): Promise<void> {
    const existing = await this.prisma.testDueSchedule.findFirst({ where: { id, patientProfileId: profileId, deletedAt: null } });
    if (!existing) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Schedule not found", 404);
    await this.prisma.$transaction(async (tx) => {
      await tx.testDueSchedule.update({ where: { id }, data: { deletedAt: new Date() } });
      await writeAudit(tx, {
        action: "test_due.deleted",
        actorUserId: actor.userId,
        actorType: actor.actorRole as AuditActorType,
        entityType: "test_due_schedule",
        entityId: id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
      });
    });
  }
}

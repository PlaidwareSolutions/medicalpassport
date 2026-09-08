/**
 * Phase 1 timeline backfill (docs_v2/04 §9.2, §14 row 4; ADR-V2-008).
 *
 * Walks every V1 clinical table that projects onto the timeline and emits
 * events through the same projectors the API uses, so a backfilled entry is
 * byte-for-byte what a live write would have produced. Idempotent via the
 * `(entityType, entityId, kind, occurredAt)` unique key: `emitHealthEvent`
 * upserts, so a re-run refreshes rather than duplicates. Resumable: keyset
 * pagination by id in batches of 500, each batch in its own transaction.
 * Logs counts only.
 *
 * Deleted source rows (`deletedAt` set) are skipped — a deleted row has no
 * live event, and a backfill must not resurrect one. Medication changes are
 * an append-only history and are all projected, deleted medicine or not.
 */
import type { PrismaClient } from "@medpass/database";
import {
  emitHealthEvent,
  projectAllergy,
  projectCheckup,
  projectCondition,
  projectMedicationChange,
  projectPrescription,
  projectReading,
  projectReport,
  projectShare,
  type HealthEventInput,
} from "@medpass/health-events";
import { BACKFILL_BATCH, type BackfillLogger } from "./backfill-provenance";

type Tz = (profileId: string) => Promise<string>;

function timezoneLookup(prisma: PrismaClient): Tz {
  const cache = new Map<string, string>();
  return async (profileId) => {
    const hit = cache.get(profileId);
    if (hit) return hit;
    const profile = await prisma.patientProfile.findUnique({ where: { id: profileId }, select: { timezone: true } });
    const tz = profile?.timezone ?? "Asia/Kolkata";
    cache.set(profileId, tz);
    return tz;
  };
}

/** Walks a table by id and emits the events each batch projects to; returns the emitted count. */
async function walk<Row extends { id: string }>(
  prisma: PrismaClient,
  name: string,
  fetch: (afterId: string | undefined) => Promise<Row[]>,
  project: (row: Row) => Promise<HealthEventInput[]>,
  log?: BackfillLogger,
): Promise<number> {
  let afterId: string | undefined;
  let total = 0;
  for (;;) {
    const rows = await fetch(afterId);
    if (rows.length === 0) break;
    const events: HealthEventInput[] = [];
    for (const row of rows) events.push(...(await project(row)));
    for (const event of events) await emitHealthEvent(prisma, event);
    total += events.length;
    afterId = rows[rows.length - 1]!.id;
    log?.info({ table: name, batch: rows.length, events: events.length, total }, "health-event backfill batch");
    if (rows.length < BACKFILL_BATCH) break;
  }
  return total;
}

export async function backfillHealthEvents(prisma: PrismaClient, log?: BackfillLogger): Promise<Record<string, number>> {
  const tz = timezoneLookup(prisma);
  const take = BACKFILL_BATCH;
  const page = (afterId: string | undefined) => ({ take, orderBy: { id: "asc" as const }, ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}) });
  const ctx = async (patientProfileId: string, actorUserId?: string | null) => ({ patientProfileId, timezone: await tz(patientProfileId), actorUserId });
  const summary: Record<string, number> = {};

  summary.medication_changes = await walk(
    prisma,
    "medication_changes",
    (afterId) =>
      prisma.medicationChange.findMany({
        ...page(afterId),
        include: {
          patientMedication: {
            select: { id: true, enteredName: true, patientProfileId: true, provenanceSource: true, verification: true, recordedByUserId: true },
          },
        },
      }),
    async (row) => {
      const m = row.patientMedication;
      const detail = row.detail && typeof row.detail === "object" && !Array.isArray(row.detail) ? (row.detail as Record<string, unknown>) : null;
      return [projectMedicationChange(await ctx(m.patientProfileId), m, { ...row, detail })];
    },
    log,
  );

  summary.prescriptions = await walk(
    prisma,
    "prescriptions",
    (afterId) =>
      prisma.prescription.findMany({
        ...page(afterId),
        where: { deletedAt: null },
        include: { practitioner: { select: { displayName: true } }, _count: { select: { medications: { where: { deletedAt: null } } } } },
      }),
    async (row) => [
      projectPrescription(await ctx(row.patientProfileId, row.recordedByUserId), {
        ...row,
        practitionerName: row.practitioner?.displayName ?? null,
        medicineCount: row._count.medications,
      }),
    ],
    log,
  );

  summary.medical_reports = await walk(
    prisma,
    "medical_reports",
    (afterId) =>
      prisma.medicalReport.findMany({
        ...page(afterId),
        where: { deletedAt: null },
        include: { _count: { select: { values: { where: { deletedAt: null } } } } },
      }),
    async (row) => [projectReport(await ctx(row.patientProfileId, row.recordedByUserId), { ...row, valueCount: row._count.values })],
    log,
  );

  summary.glucose_readings = await walk(
    prisma,
    "glucose_readings",
    (afterId) => prisma.glucoseReading.findMany({ ...page(afterId), where: { deletedAt: null } }),
    async (row) => [
      projectReading(await ctx(row.patientProfileId, row.recordedByUserId), "blood_glucose", {
        ...row,
        summary: { value: row.valueMgDl, unit: "mg/dL", context: row.context },
      }),
    ],
    log,
  );

  summary.blood_pressure_readings = await walk(
    prisma,
    "blood_pressure_readings",
    (afterId) => prisma.bloodPressureReading.findMany({ ...page(afterId), where: { deletedAt: null } }),
    async (row) => [
      projectReading(await ctx(row.patientProfileId, row.recordedByUserId), "blood_pressure", {
        ...row,
        summary: { systolic: row.systolic, diastolic: row.diastolic, pulse: row.pulseBpm, unit: "mmHg" },
      }),
    ],
    log,
  );

  summary.weight_readings = await walk(
    prisma,
    "weight_readings",
    (afterId) => prisma.weightReading.findMany({ ...page(afterId), where: { deletedAt: null } }),
    async (row) => [
      projectReading(await ctx(row.patientProfileId, row.recordedByUserId), "body_weight", {
        ...row,
        summary: { value: row.weightKg.toString(), unit: "kg" },
      }),
    ],
    log,
  );

  summary.checkup_records = await walk(
    prisma,
    "checkup_records",
    (afterId) => prisma.checkupRecord.findMany({ ...page(afterId), where: { deletedAt: null } }),
    async (row) => {
      const metrics: Record<string, boolean> = {};
      for (const key of [
        "fastingGlucoseMgDl",
        "postPrandialGlucoseMgDl",
        "hba1cPercent",
        "bloodPressureSystolic",
        "bloodPressureDiastolic",
        "weightKg",
        "waistCircumferenceCm",
        "cholesterolMgDl",
      ] as const) {
        if (row[key] != null) metrics[key] = true;
      }
      return [projectCheckup(await ctx(row.patientProfileId, row.recordedByUserId), { ...row, metrics })];
    },
    log,
  );

  summary.share_links = await walk(
    prisma,
    "share_links",
    (afterId) =>
      prisma.shareLink.findMany({
        ...page(afterId),
        include: { sharePackage: { select: { patientProfileId: true, sections: true, createdByUserId: true } } },
      }),
    async (row) => [
      projectShare(await ctx(row.sharePackage.patientProfileId, row.sharePackage.createdByUserId), {
        id: row.id,
        createdAt: row.createdAt,
        sections: row.sharePackage.sections,
        expiresAt: row.expiresAt,
        recordedByUserId: row.sharePackage.createdByUserId,
      }),
    ],
    log,
  );

  summary.patient_allergies = await walk(
    prisma,
    "patient_allergies",
    (afterId) => prisma.patientAllergy.findMany({ ...page(afterId), where: { deletedAt: null } }),
    async (row) => [projectAllergy(await ctx(row.patientProfileId, row.recordedByUserId), row)],
    log,
  );

  summary.patient_conditions = await walk(
    prisma,
    "patient_conditions",
    (afterId) => prisma.patientCondition.findMany({ ...page(afterId), where: { deletedAt: null } }),
    async (row) => [projectCondition(await ctx(row.patientProfileId, row.recordedByUserId), row)],
    log,
  );

  return summary;
}

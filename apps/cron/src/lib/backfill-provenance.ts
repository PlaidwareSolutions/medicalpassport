/**
 * Phase 1 provenance backfill (docs_v2/04 §1.2, §14 row 5; ADR-V2-002).
 *
 * Every V1 row on the provenance-bearing clinical tables has a null
 * `provenanceSource`. This fills the block so `v2_provenance_not_null` can
 * land:
 *
 * - `provenanceSource`: `ocr_extracted` when the medication (or the
 *   instruction's medication) was created from an extraction candidate;
 *   otherwise the V1 `source` column mapped through LEGACY_RECORD_SOURCE_MAP
 *   where the table has one (allergies, conditions); otherwise `user_entered`.
 * - `verification`: `patient_confirmed` — every V1 row was saved by the
 *   patient or their caregiver through the app.
 * - `recordedVia`: `pwa` — the only V1 client.
 *
 * Idempotent (only null rows are touched) and resumable (each batch of 500 is
 * its own statement). Logs counts only — never row content.
 */
import type { PrismaClient } from "@medpass/database";
import { LEGACY_RECORD_SOURCE_MAP, isLegacyRecordSource, isRecordSource, type RecordSource } from "@medpass/provenance";

export const BACKFILL_BATCH = 500;

const FILL = { verification: "patient_confirmed", recordedVia: "pwa" } as const;

export interface BackfillLogger {
  info(obj: Record<string, unknown>, msg: string): void;
}

/** A V1 `source` value (legacy or already-V2) → the V2 source; anything else is user_entered. */
export function legacySourceToV2(source: string | null | undefined): RecordSource {
  if (isLegacyRecordSource(source)) return LEGACY_RECORD_SOURCE_MAP[source];
  if (isRecordSource(source)) return source;
  return "user_entered";
}

export function medicationSourceToV2(medicationSource: string | null | undefined): RecordSource {
  return medicationSource === "extraction" ? "ocr_extracted" : "user_entered";
}

type Batch = Array<{ id: string; source: RecordSource }>;

interface TableSpec {
  name: string;
  /** Next batch of rows still missing provenance, with their resolved source. */
  fetch(): Promise<Batch>;
  /** Writes the block for these ids; returns the affected count. */
  apply(ids: string[], source: RecordSource): Promise<number>;
}

async function drain(spec: TableSpec, log?: BackfillLogger): Promise<number> {
  let total = 0;
  for (;;) {
    const batch = await spec.fetch();
    if (batch.length === 0) break;
    const bySource = new Map<RecordSource, string[]>();
    for (const row of batch) bySource.set(row.source, [...(bySource.get(row.source) ?? []), row.id]);
    let applied = 0;
    for (const [source, ids] of bySource) applied += await spec.apply(ids, source);
    total += applied;
    log?.info({ table: spec.name, batch: batch.length, applied, total }, "provenance backfill batch");
    // Every row of the batch is now stamped; a zero-applied batch would loop forever.
    if (applied === 0) break;
  }
  return total;
}

export async function backfillProvenance(prisma: PrismaClient, log?: BackfillLogger): Promise<Record<string, number>> {
  const where = { provenanceSource: null } as const;
  const take = BACKFILL_BATCH;

  const specs: TableSpec[] = [
    {
      name: "patient_medications",
      fetch: async () =>
        (await prisma.patientMedication.findMany({ where, take, select: { id: true, source: true } })).map((r) => ({
          id: r.id,
          source: medicationSourceToV2(r.source),
        })),
      apply: async (ids, source) =>
        (await prisma.patientMedication.updateMany({ where: { id: { in: ids }, ...where }, data: { provenanceSource: source, ...FILL } })).count,
    },
    {
      name: "medication_instructions",
      fetch: async () =>
        (
          await prisma.medicationInstruction.findMany({
            where,
            take,
            select: { id: true, patientMedication: { select: { source: true } } },
          })
        ).map((r) => ({ id: r.id, source: medicationSourceToV2(r.patientMedication.source) })),
      apply: async (ids, source) =>
        (await prisma.medicationInstruction.updateMany({ where: { id: { in: ids }, ...where }, data: { provenanceSource: source, ...FILL } })).count,
    },
    {
      name: "prescriptions",
      fetch: async () => (await prisma.prescription.findMany({ where, take, select: { id: true } })).map((r) => ({ id: r.id, source: "user_entered" })),
      apply: async (ids, source) =>
        (await prisma.prescription.updateMany({ where: { id: { in: ids }, ...where }, data: { provenanceSource: source, ...FILL } })).count,
    },
    {
      name: "medical_reports",
      fetch: async () => (await prisma.medicalReport.findMany({ where, take, select: { id: true } })).map((r) => ({ id: r.id, source: "user_entered" })),
      apply: async (ids, source) =>
        (await prisma.medicalReport.updateMany({ where: { id: { in: ids }, ...where }, data: { provenanceSource: source, ...FILL } })).count,
    },
    {
      name: "report_values",
      fetch: async () => (await prisma.reportValue.findMany({ where, take, select: { id: true } })).map((r) => ({ id: r.id, source: "user_entered" })),
      apply: async (ids, source) =>
        (await prisma.reportValue.updateMany({ where: { id: { in: ids }, ...where }, data: { provenanceSource: source, ...FILL } })).count,
    },
    {
      name: "glucose_readings",
      fetch: async () => (await prisma.glucoseReading.findMany({ where, take, select: { id: true } })).map((r) => ({ id: r.id, source: "user_entered" })),
      apply: async (ids, source) =>
        (await prisma.glucoseReading.updateMany({ where: { id: { in: ids }, ...where }, data: { provenanceSource: source, ...FILL } })).count,
    },
    {
      name: "blood_pressure_readings",
      fetch: async () =>
        (await prisma.bloodPressureReading.findMany({ where, take, select: { id: true } })).map((r) => ({ id: r.id, source: "user_entered" })),
      apply: async (ids, source) =>
        (await prisma.bloodPressureReading.updateMany({ where: { id: { in: ids }, ...where }, data: { provenanceSource: source, ...FILL } })).count,
    },
    {
      name: "weight_readings",
      fetch: async () => (await prisma.weightReading.findMany({ where, take, select: { id: true } })).map((r) => ({ id: r.id, source: "user_entered" })),
      apply: async (ids, source) =>
        (await prisma.weightReading.updateMany({ where: { id: { in: ids }, ...where }, data: { provenanceSource: source, ...FILL } })).count,
    },
    {
      name: "checkup_records",
      fetch: async () => (await prisma.checkupRecord.findMany({ where, take, select: { id: true } })).map((r) => ({ id: r.id, source: "user_entered" })),
      apply: async (ids, source) =>
        (await prisma.checkupRecord.updateMany({ where: { id: { in: ids }, ...where }, data: { provenanceSource: source, ...FILL } })).count,
    },
    {
      name: "patient_allergies",
      fetch: async () =>
        (await prisma.patientAllergy.findMany({ where, take, select: { id: true, source: true } })).map((r) => ({ id: r.id, source: legacySourceToV2(r.source) })),
      apply: async (ids, source) =>
        (await prisma.patientAllergy.updateMany({ where: { id: { in: ids }, ...where }, data: { provenanceSource: source, ...FILL } })).count,
    },
    {
      name: "patient_conditions",
      fetch: async () =>
        (await prisma.patientCondition.findMany({ where, take, select: { id: true, source: true } })).map((r) => ({ id: r.id, source: legacySourceToV2(r.source) })),
      apply: async (ids, source) =>
        (await prisma.patientCondition.updateMany({ where: { id: { in: ids }, ...where }, data: { provenanceSource: source, ...FILL } })).count,
    },
  ];

  const summary: Record<string, number> = {};
  for (const spec of specs) summary[spec.name] = await drain(spec, log);
  return summary;
}

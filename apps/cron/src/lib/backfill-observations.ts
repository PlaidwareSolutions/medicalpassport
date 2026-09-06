/**
 * Phase 5 observations backfill (docs_v2/04 §5.3, ADR-V2-011): copies the V1
 * `GlucoseReading`, `BloodPressureReading` and `WeightReading` diaries — plus
 * the metrics embedded in `CheckupRecord` — into the generic `Observation`
 * table, so the V2 model holds the patient's whole diary from the day it goes
 * live rather than only what was written after.
 *
 * Idempotent by construction: `(legacyEntityType, legacyId)` is a unique
 * pair, so a re-run — or a race with the live dual-write in the glucose /
 * vitals controllers — inserts nothing twice. One V1 row can become two V2
 * rows (a blood pressure and its pulse; a check-up and each metric it
 * recorded); each gets its own `legacyEntityType`, which is what keeps the
 * pair unique.
 *
 * Emits no timeline events: the V1 rows already have theirs, and a mirror is
 * the same reading, not a second one.
 *
 * Deliberately *not* copied from `CheckupRecord`: `hba1cPercent` and
 * `cholesterolMgDl`. Both are lab analytes, not home measurements — they
 * belong to `DiagnosticResult`, and putting them here would create a second,
 * unreconciled home for the same number.
 *
 * Logs counts only — never row content.
 */
import type { PrismaClient } from "@medpass/database";
import { GLUCOSE_CONTEXT_TO_OBSERVATION_CONTEXT, type GlucoseReadingContext } from "@medpass/domain";
import { dateOnlyToInstant, localIso } from "@medpass/health-events";
import { LOINC_SYSTEM, getObservationConcept } from "@medpass/terminology";

export const BACKFILL_BATCH = 500;

export interface BackfillLogger {
  info(obj: Record<string, unknown>, msg: string): void;
}

/** One V1 row + one concept = one Observation to write. */
interface Mirror {
  legacyEntityType: string;
  legacyId: string;
  patientProfileId: string;
  concept: string;
  valueNumeric: string;
  valueNumeric2?: string | null;
  context?: string | null;
  measuredAt: Date;
  notes?: string | null;
  provenanceSource: string | null;
  verification: string | null;
  recordedVia: string | null;
  recordedByUserId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
}

function toRow(m: Mirror, timezone: string): Record<string, unknown> {
  const concept = getObservationConcept(m.concept);
  return {
    patientProfileId: m.patientProfileId,
    concept: m.concept,
    conceptCode: concept?.loincCode ?? null,
    conceptSystem: concept?.loincCode ? LOINC_SYSTEM : null,
    valueNumeric: m.valueNumeric,
    valueNumeric2: m.valueNumeric2 ?? null,
    // V1 stored one unit per table by construction, and it is this concept's
    // canonical unit — nothing to convert, and nothing to guess.
    unit: concept?.canonicalUnit ?? "",
    context: m.context ?? null,
    measuredAt: m.measuredAt,
    // Resolved from the profile's timezone as it stands today; V1 never
    // stored a local time, so this is the best honest reconstruction of the
    // patient's own clock (docs/16, hazard H-28).
    measuredAtLocal: localIso(m.measuredAt, timezone),
    notes: m.notes ?? null,
    legacyEntityType: m.legacyEntityType,
    legacyId: m.legacyId,
    provenanceSource: m.provenanceSource,
    verification: m.verification,
    recordedVia: m.recordedVia,
    recordedByUserId: m.recordedByUserId,
    // A V1 row that is already gone stays gone in V2 — the mirror copies the
    // lifecycle, not just the content.
    deletedAt: m.deletedAt,
    createdAt: m.createdAt,
  };
}

export async function backfillObservations(prisma: PrismaClient, log?: BackfillLogger): Promise<Record<string, number>> {
  const timezones = new Map<string, string>();
  const timezoneFor = async (profileId: string): Promise<string> => {
    const cached = timezones.get(profileId);
    if (cached) return cached;
    const profile = await prisma.patientProfile.findUnique({ where: { id: profileId }, select: { timezone: true } });
    const timezone = profile?.timezone ?? "Asia/Kolkata";
    timezones.set(profileId, timezone);
    return timezone;
  };

  const write = async (mirrors: Mirror[]): Promise<number> => {
    if (mirrors.length === 0) return 0;
    const present = new Set(
      (
        await prisma.observation.findMany({
          where: { OR: mirrors.map((m) => ({ legacyEntityType: m.legacyEntityType, legacyId: m.legacyId })) },
          select: { legacyEntityType: true, legacyId: true },
        })
      ).map((o) => `${o.legacyEntityType}|${o.legacyId}`),
    );
    const rows: Array<Record<string, unknown>> = [];
    for (const m of mirrors) {
      if (present.has(`${m.legacyEntityType}|${m.legacyId}`)) continue;
      rows.push(toRow(m, await timezoneFor(m.patientProfileId)));
    }
    if (rows.length === 0) return 0;
    const { count } = await prisma.observation.createMany({ data: rows as never, skipDuplicates: true });
    return count;
  };

  const summary: Record<string, number> = {
    glucose_readings: 0,
    blood_pressure_readings: 0,
    blood_pressure_pulses: 0,
    weight_readings: 0,
    checkup_metrics: 0,
  };

  await drain(prisma.glucoseReading, log, "glucose_readings", async (batch) => {
    summary.glucose_readings! += await write(
      batch.map((r) => ({
        legacyEntityType: "glucose_reading",
        legacyId: r.id,
        patientProfileId: r.patientProfileId,
        concept: "blood_glucose",
        valueNumeric: String(r.valueMgDl),
        context: GLUCOSE_CONTEXT_TO_OBSERVATION_CONTEXT[r.context as GlucoseReadingContext] ?? null,
        measuredAt: r.measuredAt,
        notes: r.note,
        ...provenanceOf(r),
      })),
    );
  });

  await drain(prisma.bloodPressureReading, log, "blood_pressure_readings", async (batch) => {
    summary.blood_pressure_readings! += await write(
      batch.map((r) => ({
        legacyEntityType: "blood_pressure_reading",
        legacyId: r.id,
        patientProfileId: r.patientProfileId,
        concept: "blood_pressure",
        valueNumeric: String(r.systolic),
        valueNumeric2: String(r.diastolic),
        measuredAt: r.measuredAt,
        notes: r.note,
        ...provenanceOf(r),
      })),
    );
    // The cuff reported two different things: the pressure and the pulse. V2
    // keeps them as two observations rather than pretending a pulse is part
    // of a blood pressure — its own legacyEntityType keeps the pair unique.
    summary.blood_pressure_pulses! += await write(
      batch
        .filter((r) => r.pulseBpm != null)
        .map((r) => ({
          legacyEntityType: "blood_pressure_reading_pulse",
          legacyId: r.id,
          patientProfileId: r.patientProfileId,
          concept: "heart_rate",
          valueNumeric: String(r.pulseBpm),
          measuredAt: r.measuredAt,
          ...provenanceOf(r),
        })),
    );
  });

  await drain(prisma.weightReading, log, "weight_readings", async (batch) => {
    summary.weight_readings! += await write(
      batch.map((r) => ({
        legacyEntityType: "weight_reading",
        legacyId: r.id,
        patientProfileId: r.patientProfileId,
        concept: "body_weight",
        valueNumeric: r.weightKg.toString(),
        measuredAt: r.measuredAt,
        notes: r.note,
        ...provenanceOf(r),
      })),
    );
  });

  await drain(prisma.checkupRecord, log, "checkup_metrics", async (batch) => {
    const mirrors: Mirror[] = [];
    for (const r of batch) {
      const timezone = await timezoneFor(r.patientProfileId);
      // `checkupDate` is a date-only column: anchor it to noon in the
      // patient's zone so it sorts inside the right local day.
      const measuredAt = dateOnlyToInstant(r.checkupDate, timezone);
      const common = { legacyId: r.id, patientProfileId: r.patientProfileId, measuredAt, ...provenanceOf(r) };
      if (r.fastingGlucoseMgDl != null) {
        mirrors.push({ ...common, legacyEntityType: "checkup_record_fasting_glucose", concept: "blood_glucose", valueNumeric: String(r.fastingGlucoseMgDl), context: "fasting" });
      }
      if (r.postPrandialGlucoseMgDl != null) {
        // No context: `ObservationContext` has no post-prandial value, and
        // picking a meal ("after lunch") would be a fabrication.
        mirrors.push({ ...common, legacyEntityType: "checkup_record_post_prandial_glucose", concept: "blood_glucose", valueNumeric: String(r.postPrandialGlucoseMgDl) });
      }
      if (r.bloodPressureSystolic != null && r.bloodPressureDiastolic != null) {
        mirrors.push({ ...common, legacyEntityType: "checkup_record_blood_pressure", concept: "blood_pressure", valueNumeric: String(r.bloodPressureSystolic), valueNumeric2: String(r.bloodPressureDiastolic) });
      }
      if (r.weightKg != null) {
        mirrors.push({ ...common, legacyEntityType: "checkup_record_weight", concept: "body_weight", valueNumeric: r.weightKg.toString() });
      }
      if (r.waistCircumferenceCm != null) {
        mirrors.push({ ...common, legacyEntityType: "checkup_record_waist", concept: "waist_circumference", valueNumeric: r.waistCircumferenceCm.toString() });
      }
    }
    summary.checkup_metrics! += await write(mirrors);
  });

  return summary;
}

function provenanceOf(row: {
  provenanceSource: string | null;
  verification: string | null;
  recordedVia: string | null;
  recordedByUserId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
}) {
  return {
    provenanceSource: row.provenanceSource,
    verification: row.verification,
    recordedVia: row.recordedVia,
    recordedByUserId: row.recordedByUserId,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
  };
}

/** Walks a V1 table by id cursor, so the job is resumable after a kill. */
async function drain<T extends { id: string }>(
  model: { findMany(args: unknown): Promise<T[]> },
  log: BackfillLogger | undefined,
  name: string,
  handle: (batch: T[]) => Promise<void>,
): Promise<void> {
  let cursor: string | undefined;
  let seen = 0;
  for (;;) {
    const batch = await model.findMany({
      take: BACKFILL_BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]!.id;
    seen += batch.length;
    await handle(batch);
    log?.info({ table: name, batch: batch.length, seen }, "observations backfill batch");
    if (batch.length < BACKFILL_BATCH) break;
  }
}

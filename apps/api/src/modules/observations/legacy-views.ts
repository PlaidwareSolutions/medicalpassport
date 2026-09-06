import { GLUCOSE_CONTEXT_TO_OBSERVATION_CONTEXT, type GlucoseReadingContext } from "@medpass/domain";

/**
 * The V1 reading lists — `glucose-readings`, `blood-pressure-readings`,
 * `weight-readings` — served from `Observation` (docs_v2/05 §7: "kept,
 * served from Observation"). Until this existed, a reading entered on the
 * V2 measurements screens lived only in the new table, so the Home blood
 * sugar card and every V1 screen showed "no readings yet" while the
 * measurements hub showed the value. Two sources of truth on screen at once.
 *
 * Rows that came in through a V1 endpoint keep their V1 id here (the mirror
 * stores it as `legacyId`), so a V1 delete by that id keeps working exactly
 * as before. Rows that came in through V2 carry the observation id, and the
 * V1 delete endpoints fall back to soft-deleting the observation.
 */

export interface LegacyObservationRow {
  id: string;
  patientProfileId: string;
  concept: string;
  valueNumeric: { toString(): string } | number | string | null;
  valueNumeric2: { toString(): string } | number | string | null;
  context: string | null;
  measuredAt: Date;
  notes: string | null;
  legacyEntityType: string | null;
  legacyId: string | null;
  recordedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  provenanceSource: string | null;
  verification: string | null;
  recordedVia: string | null;
  sourceDocumentId: string | null;
  sourceExtractionId: string | null;
}

const V1_GLUCOSE_CONTEXTS = new Set<string>(Object.keys(GLUCOSE_CONTEXT_TO_OBSERVATION_CONTEXT));

function num(v: LegacyObservationRow["valueNumeric"]): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(typeof v === "object" ? v.toString() : v);
  return Number.isFinite(n) ? n : null;
}

/** Shared tail of every V1 reading DTO: identity, timing, provenance. */
function base(row: LegacyObservationRow) {
  return {
    // A mirrored V1 row answers to its V1 id; a V2-born row to its own.
    id: row.legacyId ?? row.id,
    patientProfileId: row.patientProfileId,
    measuredAt: row.measuredAt,
    note: row.notes,
    recordedByUserId: row.recordedByUserId,
    deletedAt: null as Date | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    provenanceSource: row.provenanceSource,
    verification: row.verification,
    recordedVia: row.recordedVia,
    sourceDocumentId: row.sourceDocumentId,
    sourceExtractionId: row.sourceExtractionId,
  };
}

/** `blood_glucose` observation → V1 GlucoseReading shape. V2 stores mg/dL canonically. */
export function toLegacyGlucose(row: LegacyObservationRow) {
  const value = num(row.valueNumeric);
  return {
    ...base(row),
    // V1 knows eight meal-relative contexts; a V2 context outside them
    // (fasting, resting …) is closest to "random" for a V1 reader.
    context: (row.context && V1_GLUCOSE_CONTEXTS.has(row.context) ? row.context : "random") as GlucoseReadingContext,
    valueMgDl: value === null ? null : Math.round(value),
  };
}

/**
 * `blood_pressure` observation → V1 BloodPressureReading shape. The pulse
 * lives in its own `heart_rate` row: for a mirrored reading it shares the
 * legacy id, for a V2-born one it shares the instant it was measured.
 */
export function toLegacyBloodPressure(row: LegacyObservationRow, pulses: LegacyObservationRow[]) {
  const pulse =
    pulses.find((p) => row.legacyId && p.legacyId === row.legacyId) ??
    pulses.find((p) => p.measuredAt.getTime() === row.measuredAt.getTime());
  const systolic = num(row.valueNumeric);
  const diastolic = num(row.valueNumeric2);
  const pulseValue = pulse ? num(pulse.valueNumeric) : null;
  return {
    ...base(row),
    systolic: systolic === null ? null : Math.round(systolic),
    diastolic: diastolic === null ? null : Math.round(diastolic),
    pulseBpm: pulseValue === null ? null : Math.round(pulseValue),
  };
}

/** `body_weight` observation → V1 WeightReading shape (Decimal serialised as a string, as Prisma does). */
export function toLegacyWeight(row: LegacyObservationRow) {
  const value = num(row.valueNumeric);
  return {
    ...base(row),
    weightKg: value === null ? null : String(value),
  };
}

/**
 * Bluetooth SIG GATT parsing for the two standard health services the Web Bluetooth
 * prototype reads (docs_v2/06 P5-5):
 *
 *   Blood Pressure Service 0x1810 — Blood Pressure Measurement characteristic 0x2A35
 *   Glucose Service        0x1808 — Glucose Measurement characteristic 0x2A18
 *
 * Both encode values as IEEE-11073 16-bit SFLOATs and carry optional fields behind a
 * flags byte. Pure functions over `DataView`s, so they are unit-testable without a radio,
 * and nothing here interprets a value — that is docs_v2/10 §1's rule, and it holds at the
 * parser too: a reading is numbers plus units plus a time, never a band.
 */

export const BLOOD_PRESSURE_SERVICE = 0x1810;
export const BLOOD_PRESSURE_MEASUREMENT = 0x2a35;
export const GLUCOSE_SERVICE = 0x1808;
export const GLUCOSE_MEASUREMENT = 0x2a18;
export const RECORD_ACCESS_CONTROL_POINT = 0x2a52;

/** IEEE-11073 16-bit SFLOAT: 12-bit signed mantissa, 4-bit signed exponent (base 10). */
export function readSfloat(view: DataView, offset: number): number {
  const raw = view.getUint16(offset, true);
  let mantissa = raw & 0x0fff;
  let exponent = raw >> 12;
  if (exponent >= 0x8) exponent -= 0x10;
  if (mantissa >= 0x0800) mantissa -= 0x1000;
  // Reserved special values: NaN / NRes / +INF / -INF.
  if (mantissa === 0x07ff || mantissa === 0x0800 || mantissa === 0x07fe || mantissa === -0x0802) return Number.NaN;
  return mantissa * Math.pow(10, exponent);
}

/** Bluetooth "Date Time" characteristic layout (7 bytes): year(2) month day hours minutes seconds. */
export function readDateTime(view: DataView, offset: number): Date | undefined {
  if (view.byteLength < offset + 7) return undefined;
  const year = view.getUint16(offset, true);
  const month = view.getUint8(offset + 2);
  const day = view.getUint8(offset + 3);
  if (year === 0 || month === 0 || day === 0) return undefined;
  return new Date(year, month - 1, day, view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6));
}

export interface BloodPressureMeasurement {
  systolic: number;
  diastolic: number;
  meanArterial: number;
  unit: "mmHg" | "kPa";
  measuredAt?: Date;
  pulseBpm?: number;
}

/** 0x2A35: flags(1) systolic(2) diastolic(2) MAP(2) [timestamp(7)] [pulse(2)] [userId(1)] [status(2)]. */
export function parseBloodPressureMeasurement(view: DataView): BloodPressureMeasurement {
  if (view.byteLength < 7) throw new Error("blood pressure measurement too short");
  const flags = view.getUint8(0);
  const unit = flags & 0x01 ? "kPa" : "mmHg";
  const systolic = readSfloat(view, 1);
  const diastolic = readSfloat(view, 3);
  const meanArterial = readSfloat(view, 5);
  let offset = 7;
  const out: BloodPressureMeasurement = { systolic, diastolic, meanArterial, unit };
  if (flags & 0x02) {
    const at = readDateTime(view, offset);
    if (at) out.measuredAt = at;
    offset += 7;
  }
  if (flags & 0x04 && view.byteLength >= offset + 2) {
    const pulse = readSfloat(view, offset);
    if (Number.isFinite(pulse)) out.pulseBpm = pulse;
  }
  return out;
}

export interface GlucoseMeasurement {
  sequence: number;
  measuredAt: Date;
  /** Canonical mg/dL; converted from kg/L (×100000) or mol/L (×18016 → mg/dL) as flagged. */
  valueMgDl?: number;
  context?: "capillary_whole_blood" | "capillary_plasma" | "venous_whole_blood" | "venous_plasma" | "arterial_whole_blood" | "arterial_plasma" | "undetermined_whole_blood" | "undetermined_plasma" | "interstitial_fluid" | "control_solution";
}

const GLUCOSE_SAMPLE_TYPES: Array<GlucoseMeasurement["context"] | undefined> = [
  undefined,
  "capillary_whole_blood",
  "capillary_plasma",
  "venous_whole_blood",
  "venous_plasma",
  "arterial_whole_blood",
  "arterial_plasma",
  "undetermined_whole_blood",
  "undetermined_plasma",
  "interstitial_fluid",
  "control_solution",
];

/** 0x2A18: flags(1) seq(2) baseTime(7) [timeOffset(2)] [concentration(2) typeSampleLocation(1)] [sensorStatus(2)]. */
export function parseGlucoseMeasurement(view: DataView): GlucoseMeasurement {
  if (view.byteLength < 10) throw new Error("glucose measurement too short");
  const flags = view.getUint8(0);
  const sequence = view.getUint16(1, true);
  const base = readDateTime(view, 3) ?? new Date(Number.NaN);
  let offset = 10;
  let measuredAt = base;
  if (flags & 0x01) {
    const minutes = view.getInt16(offset, true);
    measuredAt = new Date(base.getTime() + minutes * 60_000);
    offset += 2;
  }
  const out: GlucoseMeasurement = { sequence, measuredAt };
  if (flags & 0x02 && view.byteLength >= offset + 3) {
    const raw = readSfloat(view, offset);
    const molPerL = (flags & 0x04) !== 0;
    // kg/L → mg/dL is ×100 000; mol/L → mg/dL is ×18 016 (glucose 180.16 g/mol, ×100 for dL).
    const mgDl = molPerL ? raw * 18_016 : raw * 100_000;
    if (Number.isFinite(mgDl)) out.valueMgDl = Math.round(mgDl * 10) / 10;
    const type = view.getUint8(offset + 2) & 0x0f;
    const context = GLUCOSE_SAMPLE_TYPES[type];
    if (context) out.context = context;
  }
  return out;
}

import { z } from "zod";
import { GLUCOSE_READING_CONTEXTS } from "@medpass/domain";

export const glucoseReadingSchema = z.object({
  measuredAt: z.coerce.date(),
  context: z.enum(GLUCOSE_READING_CONTEXTS),
  // Wide, sanity-only bounds (mg/dL) — no clinical judgment implied, just guards against a fat-fingered entry.
  valueMgDl: z.coerce.number().int().min(20).max(999),
  note: z.string().trim().max(500).optional(),
});
export type GlucoseReadingInput = z.infer<typeof glucoseReadingSchema>;

/** Home blood-pressure diary (screen 46). Bounds match checkupRecordSchema's BP fields — sanity-only, no clinical judgment implied. */
export const bloodPressureReadingSchema = z.object({
  measuredAt: z.coerce.date(),
  systolic: z.coerce.number().int().min(50).max(300),
  diastolic: z.coerce.number().int().min(30).max(200),
  pulseBpm: z.coerce.number().int().min(20).max(300).optional(),
  note: z.string().trim().max(500).optional(),
});
export type BloodPressureReadingInput = z.infer<typeof bloodPressureReadingSchema>;

/** Body-weight diary (screen 47). kg only — the unit checkupRecordSchema.weightKg already established. */
export const weightReadingSchema = z.object({
  measuredAt: z.coerce.date(),
  weightKg: z.coerce.number().min(1).max(400),
  note: z.string().trim().max(500).optional(),
});
export type WeightReadingInput = z.infer<typeof weightReadingSchema>;

export const checkupRecordSchema = z.object({
  checkupDate: z.coerce.date(),
  fastingGlucoseMgDl: z.coerce.number().int().min(20).max(999).optional(),
  postPrandialGlucoseMgDl: z.coerce.number().int().min(20).max(999).optional(),
  hba1cPercent: z.coerce.number().min(2).max(20).optional(),
  bloodPressureSystolic: z.coerce.number().int().min(50).max(300).optional(),
  bloodPressureDiastolic: z.coerce.number().int().min(30).max(200).optional(),
  weightKg: z.coerce.number().min(1).max(400).optional(),
  waistCircumferenceCm: z.coerce.number().min(20).max(300).optional(),
  cholesterolMgDl: z.coerce.number().int().min(50).max(999).optional(),
  treatmentChanges: z.string().trim().max(500).optional(),
  nextAppointmentDate: z.coerce.date().optional(),
});
export type CheckupRecordInput = z.infer<typeof checkupRecordSchema>;

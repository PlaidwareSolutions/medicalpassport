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

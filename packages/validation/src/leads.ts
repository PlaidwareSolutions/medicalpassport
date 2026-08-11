import { z } from "zod";

/**
 * Professional (clinic/doctor/pharmacy) lead capture — OD-LP-2.
 *
 * Business contact information ONLY. This schema is deliberately strict
 * (`.strict()`) so any unexpected field — especially anything that looks
 * like patient/health data — is rejected outright rather than silently
 * stored. The public marketing lead form never collects patient information.
 */
export const PROFESSIONAL_ROLES = [
  "doctor",
  "pharmacist",
  "clinic_owner",
  "hospital_admin",
  "care_coordinator",
  "other",
] as const;

export const createLeadSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    organization: z.string().trim().min(1).max(160),
    role: z.enum(PROFESSIONAL_ROLES),
    city: z.string().trim().min(1).max(120),
    // At least one of email/phone is required (refine below). Empty string is
    // normalized to undefined so the "at least one" check is meaningful.
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{6,20}$/, "Enter a valid phone number")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    message: z.string().trim().max(2000).optional().or(z.literal("").transform(() => undefined)),
    consentToContact: z.literal(true, {
      errorMap: () => ({ message: "Consent is required" }),
    }),
    turnstileToken: z.string().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.email) || Boolean(v.phone), {
    message: "Provide an email or a phone number",
    path: ["email"],
  });

export type CreateLeadInput = z.infer<typeof createLeadSchema>;

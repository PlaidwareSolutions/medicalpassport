import { z } from "zod";
import { ENCOUNTER_KINDS, ORGANIZATION_KINDS } from "@medpass/domain";
import { phoneSchema } from "./auth.js";
import { instructionSchema } from "./medication.js";
import { prescriptionItemSchema } from "./prescription.js";
import { addDiagnosticResultSchema, createDiagnosticReportSchema } from "./diagnostics.js";

/**
 * Provider portals (docs_v2/05 §11, ADR-V2-009 "providers propose, patients
 * accept"). Everything a clinic, pharmacy, laboratory or hospital sends is a
 * *proposal*; nothing here writes a clinical table until the patient accepts.
 * Provenance is never client-supplied (ADR-V2-002).
 */

// ───────────────────────── auth ─────────────────────────

/** Phone OTP sign-in for provider staff (docs_v2/06 P11-2). */
export const providerLoginSchema = z.object({
  phone: phoneSchema,
  turnstileToken: z.string().max(4096).optional(),
});
export type ProviderLoginInput = z.infer<typeof providerLoginSchema>;

/** Second step: the 6-digit code from the SMS/voice OTP. */
export const providerTotpSchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, "The code is 6 digits"),
});
export type ProviderTotpInput = z.infer<typeof providerTotpSchema>;

// ───────────────────────── organizations ─────────────────────────

export const ORGANIZATION_MEMBER_ROLES = ["owner", "doctor", "staff", "pharmacist", "lab_tech"] as const;
export type OrganizationMemberRoleInput = (typeof ORGANIZATION_MEMBER_ROLES)[number];

export const updateProviderOrganizationSchema = z
  .object({
    kind: z.enum(ORGANIZATION_KINDS).optional(),
    displayName: z.string().trim().min(1).max(160).optional(),
    addressText: z.string().trim().min(1).max(500).nullable().optional(),
    city: z.string().trim().min(1).max(100).nullable().optional(),
    state: z.string().trim().min(1).max(100).nullable().optional(),
    pincode: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit PIN code").nullable().optional(),
    phone: phoneSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type UpdateProviderOrganizationInput = z.infer<typeof updateProviderOrganizationSchema>;

/** Members are invited by phone; the user row is created (as a provider) if it does not exist yet. */
export const addOrganizationMemberSchema = z.object({
  phone: phoneSchema,
  role: z.enum(ORGANIZATION_MEMBER_ROLES).default("staff"),
});
export type AddOrganizationMemberInput = z.infer<typeof addOrganizationMemberSchema>;

export const updateOrganizationMemberSchema = z
  .object({
    role: z.enum(ORGANIZATION_MEMBER_ROLES).optional(),
    status: z.enum(["active", "suspended"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type UpdateOrganizationMemberInput = z.infer<typeof updateOrganizationMemberSchema>;

// ───────────────────────── QR onboarding ─────────────────────────

/**
 * Sections a provider link may grant — the share vocabulary (docs_v2/04
 * §11), so the Doctor Snapshot a clinic sees is exactly the one a share
 * recipient would see for the same choice.
 */
export const PROVIDER_LINK_SECTIONS = [
  "medications",
  "allergies",
  "conditions",
  "recentChanges",
  "concerns",
  "glucoseReadings",
  "bloodPressureReadings",
  "weightReadings",
  "checkups",
  "prescriptions",
  "reports",
  "measurements",
  "documents",
  "encounters",
] as const;
export type ProviderLinkSection = (typeof PROVIDER_LINK_SECTIONS)[number];

export const ONBOARDING_TOKEN_EXPIRIES = ["15m", "1h", "24h"] as const;

/** The patient mints a short-lived QR token; the clinic scans it (docs_v2/06 P11-3). */
export const createOnboardingTokenSchema = z.object({
  sections: z.array(z.enum(PROVIDER_LINK_SECTIONS)).min(1).max(PROVIDER_LINK_SECTIONS.length),
  expiresIn: z.enum(ONBOARDING_TOKEN_EXPIRIES).default("15m"),
  /** How long the resulting provider link stays open once redeemed. */
  accessDays: z.coerce.number().int().min(1).max(90).default(30),
});
export type CreateOnboardingTokenInput = z.infer<typeof createOnboardingTokenSchema>;

export const onboardPatientSchema = z.object({
  qrToken: z.string().trim().min(16).max(200),
});
export type OnboardPatientInput = z.infer<typeof onboardPatientSchema>;

// ───────────────────────── proposals ─────────────────────────

export const RECONCILIATION_LINE_DECISIONS = ["START", "CONTINUE", "CHANGE", "STOP"] as const;
export type ReconciliationLineDecision = (typeof RECONCILIATION_LINE_DECISIONS)[number];

/**
 * One transition line (docs_v2/06 P14; hazard H-34). A medicine is "current"
 * after acceptance only through an explicit START / CONTINUE / CHANGE —
 * a STOP line can never become a current medicine, and a line without a
 * decision does not exist.
 */
export const reconciliationLineSchema = z
  .object({
    decision: z.enum(RECONCILIATION_LINE_DECISIONS),
    /** The patient's existing medicine — required for CONTINUE / CHANGE / STOP. */
    patientMedicationId: z.string().uuid().nullable().optional(),
    /** Required for START. */
    proposedName: z.string().trim().min(1).max(200).nullable().optional(),
    productId: z.string().uuid().nullable().optional(),
    /** Required for START and CHANGE. */
    proposedInstruction: instructionSchema.nullable().optional(),
    reasonText: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision === "START") {
      if (!v.proposedName) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["proposedName"], message: "Name the medicine to start" });
      if (!v.proposedInstruction) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["proposedInstruction"], message: "A medicine is never started without a dose" });
      }
    } else {
      if (!v.patientMedicationId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["patientMedicationId"], message: "Say which of the patient's medicines this line is about" });
      }
      if (v.decision === "CHANGE" && !v.proposedInstruction) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["proposedInstruction"], message: "A change needs the new instruction" });
      }
    }
  });
export type ReconciliationLineInput = z.infer<typeof reconciliationLineSchema>;

export const proposeReconciliationSchema = z.object({
  notes: z.string().trim().max(2000).nullable().optional(),
  practitionerName: z.string().trim().max(120).optional(),
  lines: z.array(reconciliationLineSchema).min(1).max(50),
});
export type ProposeReconciliationInput = z.infer<typeof proposeReconciliationSchema>;

/** A captured prescription: its items land in the patient's confirmation queue on acceptance. */
export const proposePrescriptionSchema = z
  .object({
    practitionerName: z.string().trim().max(120).optional(),
    prescribedAt: z.coerce.date().optional(),
    notes: z.string().trim().max(1000).optional(),
    diagnosisText: z.string().trim().max(500).nullable().optional(),
    validUntil: z.coerce.date().nullable().optional(),
    followUpOn: z.coerce.date().nullable().optional(),
    items: z.array(prescriptionItemSchema).min(1).max(30),
  })
  .superRefine((v, ctx) => {
    if (v.prescribedAt && v.validUntil && v.validUntil < v.prescribedAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["validUntil"], message: "Valid-until is before the prescription date" });
    }
  });
export type ProposePrescriptionInput = z.infer<typeof proposePrescriptionSchema>;

export const proposeEncounterSchema = z
  .object({
    kind: z.enum(ENCOUNTER_KINDS).default("outpatient"),
    startedAt: z.coerce.date(),
    endedAt: z.coerce.date().nullable().optional(),
    practitionerName: z.string().trim().max(120).optional(),
    reasonText: z.string().trim().max(500).nullable().optional(),
    diagnosisText: z.string().trim().max(500).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    /** A follow-up visit the doctor asked for; becomes a reminder on acceptance. */
    followUpOn: z.coerce.date().nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.endedAt && v.endedAt < v.startedAt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endedAt"], message: "End is before start" });
  });
export type ProposeEncounterInput = z.infer<typeof proposeEncounterSchema>;

/** Pharmacy dispense record (docs_v2/06 P12): "Apollo Pharmacy recorded a refill". */
export const proposeDispenseSchema = z.object({
  /** The patient's medicine this refill is for, when the pharmacist could identify it from the snapshot. */
  patientMedicationId: z.string().uuid().nullable().optional(),
  medicineName: z.string().trim().min(1).max(200),
  dispensedAt: z.coerce.date(),
  quantity: z.coerce.number().positive().max(100_000),
  unit: z.string().trim().min(1).max(30),
  daysSupply: z.coerce.number().int().positive().max(365).nullable().optional(),
  lotNumber: z.string().trim().max(60).nullable().optional(),
  expiryDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});
export type ProposeDispenseInput = z.infer<typeof proposeDispenseSchema>;

/** Laboratory report with results (docs_v2/06 P13 level 3): lands `source_authenticated`, still queued for acceptance. */
export const proposeDiagnosticReportSchema = createDiagnosticReportSchema
  .omit({ organizationId: true, encounterId: true })
  .extend({
    results: z.array(addDiagnosticResultSchema).max(200).default([]),
  });
export type ProposeDiagnosticReportInput = z.infer<typeof proposeDiagnosticReportSchema>;

/**
 * Hospital transition record (docs_v2/06 P14). The admission becomes an
 * inpatient encounter; the lines are a reconciliation. Hazard H-34: there
 * is no "current medicines" list here on purpose — only decided lines.
 */
export const proposeDischargeSchema = z
  .object({
    admittedAt: z.coerce.date(),
    dischargedAt: z.coerce.date(),
    diagnosisText: z.string().trim().max(500).nullable().optional(),
    summaryText: z.string().trim().max(4000).nullable().optional(),
    practitionerName: z.string().trim().max(120).optional(),
    followUpOn: z.coerce.date().nullable().optional(),
    lines: z.array(reconciliationLineSchema).min(1).max(50),
  })
  .superRefine((v, ctx) => {
    if (v.dischargedAt < v.admittedAt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dischargedAt"], message: "Discharge is before admission" });
  });
export type ProposeDischargeInput = z.infer<typeof proposeDischargeSchema>;

export const PROPOSAL_STATUSES = ["proposed", "accepted", "rejected", "withdrawn", "expired"] as const;

export const proposalsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(PROPOSAL_STATUSES).optional(),
});
export type ProposalsQuery = z.infer<typeof proposalsQuerySchema>;

/**
 * Accepting a reconciliation / discharge may decline individual lines
 * (H-43: a STOP line is confirmed individually). Indexes into `lines`.
 */
export const acceptProposalSchema = z.object({
  declinedLines: z.array(z.number().int().nonnegative().max(49)).max(50).default([]),
});
export type AcceptProposalInput = z.infer<typeof acceptProposalSchema>;

export const rejectProposalSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type RejectProposalInput = z.infer<typeof rejectProposalSchema>;

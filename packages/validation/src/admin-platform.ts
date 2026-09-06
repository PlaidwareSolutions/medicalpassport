import { z } from "zod";

/**
 * V2 admin platform (docs_v2/14 §3, docs_v2/05 §13): feature flags, support
 * cases, break-glass, and the read-only explorers. Every id an admin sends
 * or receives is opaque; nothing here carries a clinical value.
 */

const cursorFields = {
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
};

// ───────────────────────── Feature flags ─────────────────────────

const FLAG_KEY = /^[a-zA-Z][a-zA-Z0-9_]{1,63}$/;
export const featureFlagKeySchema = z.string().regex(FLAG_KEY, "Flag keys are camelCase or snake_case identifiers");

export const putFeatureFlagSchema = z.object({
  description: z.string().trim().max(500).nullable().optional(),
  defaultOn: z.boolean(),
  /** 0 = nobody outside the allowlist; 100 = everyone. */
  rolloutPercent: z.number().int().min(0).max(100).default(0),
  allowProfileIds: z.array(z.string().uuid()).max(500).default([]),
  /** `null` = every environment; otherwise the NODE_ENV the row applies to. */
  environment: z.enum(["development", "test", "staging", "production"]).nullable().optional(),
  /** Written to the audit chain with the change — the "why". */
  note: z.string().trim().min(3).max(500),
});
export type PutFeatureFlagInput = z.infer<typeof putFeatureFlagSchema>;

// ───────────────────────── Support cases ─────────────────────────

export const SUPPORT_CASE_STATUSES = ["open", "waiting_on_patient", "resolved", "closed"] as const;
export type SupportCaseStatus = (typeof SUPPORT_CASE_STATUSES)[number];
export const SUPPORT_CASE_CHANNELS = ["in_app", "email", "phone", "whatsapp", "provider"] as const;

export const createSupportCaseSchema = z.object({
  /** A short operational subject — never a clinical detail; the case notes are the place for context, and they too are PHI-free by policy. */
  subject: z.string().trim().min(3).max(160),
  channel: z.enum(SUPPORT_CASE_CHANNELS).default("in_app"),
  patientProfileId: z.string().uuid().nullable().optional(),
  assignedAdminId: z.string().uuid().nullable().optional(),
});
export type CreateSupportCaseInput = z.infer<typeof createSupportCaseSchema>;

export const updateSupportCaseSchema = z
  .object({
    subject: z.string().trim().min(3).max(160).optional(),
    status: z.enum(SUPPORT_CASE_STATUSES).optional(),
    assignedAdminId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type UpdateSupportCaseInput = z.infer<typeof updateSupportCaseSchema>;

export const supportCaseNoteSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});
export type SupportCaseNoteInput = z.infer<typeof supportCaseNoteSchema>;

export const supportCasesQuerySchema = z.object({
  status: z.enum(SUPPORT_CASE_STATUSES).optional(),
  patientProfileId: z.string().uuid().optional(),
  assignedAdminId: z.string().uuid().optional(),
  ...cursorFields,
});
export type SupportCasesQuery = z.infer<typeof supportCasesQuerySchema>;

// ───────────────────────── Break-glass ─────────────────────────

export const BREAK_GLASS_MAX_MINUTES = 60;

/** docs_v2/10 H-49, docs_v2/11 §7: reason required, time-boxed (≤ 60 min), TOTP re-verified, patient notified. */
export const breakGlassRequestSchema = z.object({
  profileId: z.string().uuid(),
  reason: z.string().trim().min(10).max(500),
  minutes: z.number().int().min(1).max(BREAK_GLASS_MAX_MINUTES),
  supportCaseId: z.string().uuid().optional(),
  /** The admin's current authenticator code — step-up for admins is a fresh TOTP, not the patient OTP flow. */
  totpCode: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});
export type BreakGlassRequestInput = z.infer<typeof breakGlassRequestSchema>;

export const breakGlassListQuerySchema = z.object({
  /** `true` = only grants still inside their window. */
  active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  patientProfileId: z.string().uuid().optional(),
  adminUserId: z.string().uuid().optional(),
  ...cursorFields,
});
export type BreakGlassListQuery = z.infer<typeof breakGlassListQuerySchema>;

// ───────────────────────── Explorers ─────────────────────────

export const consentAuditQuerySchema = z.object({
  profileId: z.string().uuid(),
});
export type ConsentAuditQuery = z.infer<typeof consentAuditQuerySchema>;

export const abdmTransactionsQuerySchema = z.object({
  status: z.string().trim().min(1).max(40).optional(),
  kind: z.string().trim().min(1).max(60).optional(),
  direction: z.string().trim().min(1).max(20).optional(),
  errorCode: z.string().trim().min(1).max(80).optional(),
  /** `true` = only rows with an error code. */
  errorsOnly: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  gatewayEnv: z.enum(["mock", "sandbox", "production"]).optional(),
  ...cursorFields,
});
export type AbdmTransactionsQuery = z.infer<typeof abdmTransactionsQuerySchema>;

export const fhirValidationFailuresQuerySchema = z.object({
  direction: z.string().trim().min(1).max(20).optional(),
  severity: z.string().trim().min(1).max(20).optional(),
  resourceType: z.string().trim().min(1).max(60).optional(),
  igVersion: z.string().trim().min(1).max(20).optional(),
  ...cursorFields,
});
export type FhirValidationFailuresQuery = z.infer<typeof fhirValidationFailuresQuerySchema>;

export const notificationFailuresQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).default(7),
});
export type NotificationFailuresQuery = z.infer<typeof notificationFailuresQuerySchema>;

export const documentsStatusQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});
export type DocumentsStatusQuery = z.infer<typeof documentsStatusQuerySchema>;

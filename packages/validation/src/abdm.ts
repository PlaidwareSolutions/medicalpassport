import { z } from "zod";

/**
 * ABDM patient-facing flows (docs_v2/05 §10, docs_v2/08 §5 M8A/M8B). Every body here is what
 * the patient types or chooses; the gateway's own ids come back in responses, never in requests.
 */

export const ABHA_LINK_METHODS = ["abha_number", "mobile", "aadhaar_otp"] as const;
export type AbhaLinkMethod = (typeof ABHA_LINK_METHODS)[number];

/** ABHA number: 14 digits, optionally grouped `91-1234-5678-9012`. */
const abhaNumber = z
  .string()
  .trim()
  .regex(/^\d{2}-?\d{4}-?\d{4}-?\d{4}$/, "ABHA number must be 14 digits (91-1234-5678-9012)");

/** ABHA address: `name@sbx` / `name@abdm`. */
const abhaAddress = z
  .string()
  .trim()
  .regex(/^[a-z0-9._-]{3,64}@[a-z]{2,12}$/i, "ABHA address must look like name@sbx");

export const abhaLinkInitSchema = z
  .object({
    method: z.enum(ABHA_LINK_METHODS),
    /** Required for `abha_number`; the number the OTP is sent against. */
    abhaNumber: abhaNumber.optional(),
    /** Required for `mobile`: E.164 phone registered with ABDM. */
    mobile: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/, "E.164 phone")
      .optional(),
    /** Required for `aadhaar_otp`: 12-digit Aadhaar, never stored. */
    aadhaar: z
      .string()
      .trim()
      .regex(/^\d{12}$/, "12-digit Aadhaar")
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.method === "abha_number" && !v.abhaNumber) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["abhaNumber"], message: "abhaNumber is required for method abha_number" });
    if (v.method === "mobile" && !v.mobile) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mobile"], message: "mobile is required for method mobile" });
    if (v.method === "aadhaar_otp" && !v.aadhaar) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["aadhaar"], message: "aadhaar is required for method aadhaar_otp" });
  });
export type AbhaLinkInitInput = z.infer<typeof abhaLinkInitSchema>;

export const abhaLinkVerifySchema = z
  .object({
    transactionId: z.string().trim().min(1).max(128),
    otp: z.string().trim().regex(/^\d{6}$/, "6-digit OTP"),
    /** When the account has several ABHA addresses, the patient picks one; otherwise the gateway's default. */
    abhaAddress: abhaAddress.optional(),
  })
  .strict();
export type AbhaLinkVerifyInput = z.infer<typeof abhaLinkVerifySchema>;

export const abdmDiscoverSchema = z
  .object({
    /** HIP to discover at; omitted = every HIP the gateway knows for this patient (mock: fixture HIP). */
    hipId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();
export type AbdmDiscoverInput = z.infer<typeof abdmDiscoverSchema>;

export const abdmCareContextLinkSchema = z
  .object({
    /** Discovery transaction the care contexts came from. */
    transactionId: z.string().trim().min(1).max(128),
    hipId: z.string().trim().min(1).max(64),
    patientReferenceNumber: z.string().trim().min(1).max(128),
    careContextReferences: z.array(z.string().trim().min(1).max(128)).min(1).max(50),
    /** OTP delivered by the HIP during link confirm (mock: 000000). */
    otp: z
      .string()
      .trim()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .strict();
export type AbdmCareContextLinkInput = z.infer<typeof abdmCareContextLinkSchema>;

export const abdmConsentRevokeSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type AbdmConsentRevokeInput = z.infer<typeof abdmConsentRevokeSchema>;

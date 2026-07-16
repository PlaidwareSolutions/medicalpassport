import { z } from "zod";
import { SUPPORTED_LOCALES } from "@medpass/domain";

/**
 * Indian mobile numbers are the primary audience (+91 XXXXXXXXXX), but other
 * E.164 numbers are accepted at the auth layer (docs/24 assumption 3).
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, "Enter the mobile number with country code, e.g. +91"));

export const otpRequestSchema = z.object({
  phone: phoneSchema,
  purpose: z.enum(["login", "recovery"]).default("login"),
  turnstileToken: z.string().max(4096).optional(),
});
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, "The code is 6 digits"),
  device: z
    .object({
      kind: z.enum(["browser", "android", "ios"]).default("browser"),
      label: z.string().max(120).optional(),
    })
    .default({ kind: "browser" }),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
});
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(512),
});

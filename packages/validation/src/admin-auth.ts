import { z } from "zod";

export const adminLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(256),
  turnstileToken: z.string().max(4096).optional(),
});
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

export const adminMfaCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "The code is 6 digits"),
});
export type AdminMfaCodeInput = z.infer<typeof adminMfaCodeSchema>;

export const adminRefreshSchema = z.object({
  refreshToken: z.string().min(20).max(512),
});
export type AdminRefreshInput = z.infer<typeof adminRefreshSchema>;

import { z } from "zod";
import { SHARE_AUDIENCES, SHARE_EXPIRY_PRESETS, SHARE_MAX_EXPIRY_MINUTES } from "@medpass/domain";

/**
 * Sections a share may carry (docs_v2/04 §11). V1 keys stay; V2 adds
 * `measurements` (Observation aggregates), `documents` (page access via the
 * public document route), `encounters`, and `full_passport` (every section,
 * documents included). `conditions` already existed.
 *
 * The stored JSON is frozen at creation and read back verbatim (see
 * SharingService.accessByToken): a link minted before a key existed never
 * gains it. That rule lives in the service, not here.
 */
export const shareSectionsSchema = z.object({
  medications: z.boolean().optional(),
  allergies: z.boolean().optional(),
  conditions: z.boolean().optional(),
  recentChanges: z.boolean().optional(),
  concerns: z.boolean().optional(),
  glucoseReadings: z.boolean().optional(),
  bloodPressureReadings: z.boolean().optional(),
  weightReadings: z.boolean().optional(),
  checkups: z.boolean().optional(),
  prescriptions: z.boolean().optional(),
  reports: z.boolean().optional(),
  measurements: z.boolean().optional(),
  documents: z.boolean().optional(),
  encounters: z.boolean().optional(),
  /** Every section on, documents included. Stored alongside the expanded booleans. */
  full_passport: z.boolean().optional(),
});
export type ShareSectionsInput = z.infer<typeof shareSectionsSchema>;

/**
 * HOW LONG (docs_v2/05 §9): a preset, an explicit `expiresAt`, or the V1
 * `expiresInHours`. Precedence when several are sent: `expiresAt`, then
 * `expiresIn`, then `expiresInHours` (default 24 h). Every path is capped at
 * 30 days server-side as well.
 */
export const createShareSchema = z
  .object({
    sections: shareSectionsSchema.default({}),
    expiresInHours: z.coerce.number().int().min(1).max(30 * 24).default(24),
    expiresIn: z.enum(SHARE_EXPIRY_PRESETS).optional(),
    expiresAt: z.coerce.date().optional(),
    kind: z.enum(["link", "qr"]).default("link"),
    /** WHO the link is for. Informational and logged; never an authorization. */
    audience: z.enum(SHARE_AUDIENCES).default("unspecified"),
  })
  .superRefine((value, ctx) => {
    if (value.expiresAt) {
      const minutes = (value.expiresAt.getTime() - Date.now()) / 60_000;
      if (minutes <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "Expiry must be in the future" });
      } else if (minutes > SHARE_MAX_EXPIRY_MINUTES) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "A share can last at most 30 days" });
      }
    }
  });
export type CreateShareInput = z.infer<typeof createShareSchema>;

/** Query-string booleans arrive as "true"/"false" strings — absent or "true" means included, only literal "false" excludes it. */
const sectionQueryFlag = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v !== "false");

export const visitSummaryTextQuerySchema = z.object({
  medications: sectionQueryFlag,
  allergies: sectionQueryFlag,
  conditions: sectionQueryFlag,
  recentChanges: sectionQueryFlag,
  concerns: sectionQueryFlag,
  glucoseReadings: sectionQueryFlag,
  bloodPressureReadings: sectionQueryFlag,
  weightReadings: sectionQueryFlag,
  checkups: sectionQueryFlag,
  prescriptions: sectionQueryFlag,
  reports: sectionQueryFlag,
  measurements: sectionQueryFlag,
  encounters: sectionQueryFlag,
  /** Off by default on the text export: a WhatsApp message cannot carry page access anyway. */
  documents: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
export type VisitSummaryTextQuery = z.infer<typeof visitSummaryTextQuerySchema>;

/** `GET profiles/current/activity` (docs_v2/05 §8): cursor-paginated "who changed what". */
export const activityQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ActivityQuery = z.infer<typeof activityQuerySchema>;

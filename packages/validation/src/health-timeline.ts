import { z } from "zod";
import { HEALTH_EVENT_KINDS } from "@medpass/domain";

const kindEnum = z.enum(HEALTH_EVENT_KINDS);

/**
 * `GET profiles/current/health-timeline` (docs_v2/05 §3). `kinds` arrives
 * comma-separated (`?kinds=prescription,measurement`) or repeated; unknown
 * kinds are a validation error rather than silently ignored. `cursor` is the
 * opaque value the previous page returned.
 */
export const healthTimelineQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  kinds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((raw) => {
      if (raw === undefined) return undefined;
      const parts = (Array.isArray(raw) ? raw : [raw])
        .flatMap((s) => s.split(","))
        .map((s) => s.trim())
        .filter(Boolean);
      return parts.length > 0 ? parts : undefined;
    })
    .pipe(z.array(kindEnum).optional()),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  includeSuperseded: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .default(false)
    .transform((v) => v === true || v === "true" || v === "1"),
});
export type HealthTimelineQuery = z.infer<typeof healthTimelineQuerySchema>;

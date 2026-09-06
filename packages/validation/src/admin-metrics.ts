import { z } from "zod";

/** Longest window one aggregate call may cover — the admin card reads a week; a quarter is the ceiling. */
export const PRODUCT_METRICS_MAX_DAYS = 92;

/**
 * `GET admin/metrics/product?from&to` (docs_v2/06 P1-7). Both bounds are
 * instants; `to` defaults to now and `from` to seven days earlier. The
 * response is counts per catalogue event per day — never a row, never an id.
 */
export const adminProductMetricsQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .transform((v) => {
    const to = v.to ?? new Date();
    const from = v.from ?? new Date(to.getTime() - 7 * 86_400_000);
    return { from, to };
  })
  .superRefine((v, ctx) => {
    if (v.from > v.to) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["from"], message: "`from` must not be after `to`" });
    if (v.to.getTime() - v.from.getTime() > PRODUCT_METRICS_MAX_DAYS * 86_400_000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: `At most ${PRODUCT_METRICS_MAX_DAYS} days per call` });
    }
  });
export type AdminProductMetricsQuery = z.infer<typeof adminProductMetricsQuerySchema>;

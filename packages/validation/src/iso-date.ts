import { z } from "zod";

/**
 * Calendar date (`YYYY-MM-DD`) for `@db.Date` columns — onset, administered,
 * performed dates. Kept as a string here; services convert to a UTC-midnight
 * `Date`, which is what Prisma stores and what `dateOnlyToInstant` in
 * @medpass/health-events expects back.
 */
export const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine(
    (v) => {
      const d = new Date(`${v}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
    },
    { message: "Not a real calendar date" },
  )
  .refine((v) => v <= new Date().toISOString().slice(0, 10), { message: "Date cannot be in the future" });
export type IsoDate = z.infer<typeof isoDateSchema>;

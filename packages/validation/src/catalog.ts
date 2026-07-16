import { z } from "zod";

export const catalogSearchSchema = z.object({
  q: z.string().trim().min(2).max(100),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});
export type CatalogSearchInput = z.infer<typeof catalogSearchSchema>;

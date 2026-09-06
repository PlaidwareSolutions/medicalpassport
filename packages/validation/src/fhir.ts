import { z } from "zod";

/**
 * FHIR export (docs_v2/05 §10, docs_v2/08 §2): `?ig=6.5|7.0` selects the IG folder; the
 * default is the certification target (v6.5). The Indian Patient Summary exists only in v7.0.
 */
export const FHIR_IG_VERSIONS = ["6.5", "7.0"] as const;
export type FhirIgVersion = (typeof FHIR_IG_VERSIONS)[number];

export const fhirExportQuerySchema = z
  .object({
    ig: z.enum(FHIR_IG_VERSIONS).default("6.5"),
  })
  .strict();
export type FhirExportQuery = z.infer<typeof fhirExportQuerySchema>;

export const fhirPatientSummaryQuerySchema = z
  .object({
    ig: z.literal("7.0").default("7.0"),
  })
  .strict();
export type FhirPatientSummaryQuery = z.infer<typeof fhirPatientSummaryQuerySchema>;

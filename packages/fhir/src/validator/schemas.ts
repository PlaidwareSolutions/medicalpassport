/**
 * Structural zod schemas for the R4 resources this package produces. Element lists follow
 * FHIR R4 4.0.1; objects are `strict()` so unknown elements surface as failures instead of
 * silently passing to a receiver.
 */
import { z } from "zod";

// ---- primitives -------------------------------------------------------------------------

export const fhirId = z.string().regex(/^[A-Za-z0-9\-.]{1,64}$/, "must be a FHIR id ([A-Za-z0-9-.]{1,64})");
export const fhirCode = z.string().regex(/^[^\s]+(\s[^\s]+)*$/, "must be a FHIR code (no leading/trailing/double whitespace)");
export const fhirUri = z.string().min(1, "must be a non-empty uri");
export const fhirString = z.string().min(1, "must be a non-empty string");
export const fhirDate = z.string().regex(/^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/, "must be a FHIR date (YYYY, YYYY-MM or YYYY-MM-DD)");
export const fhirDateTime = z
  .string()
  .regex(
    /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01])(T([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d+)?(Z|[+-]((0\d|1[0-3]):[0-5]\d|14:00)))?)?)?$/,
    "must be a FHIR dateTime (time part requires a timezone)",
  );
export const fhirInstant = z
  .string()
  .regex(
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d+)?(Z|[+-]((0\d|1[0-3]):[0-5]\d|14:00))$/,
    "must be a FHIR instant (full date-time with timezone)",
  );

// ---- data types -------------------------------------------------------------------------

export const extensionSchema = z
  .object({
    url: fhirUri,
    valueCode: fhirCode.optional(),
    valueString: fhirString.optional(),
    valueUri: fhirUri.optional(),
    valueBoolean: z.boolean().optional(),
    valueDateTime: fhirDateTime.optional(),
  })
  .strict();

export const codingSchema = z
  .object({
    system: fhirUri.optional(),
    version: fhirString.optional(),
    code: fhirCode.optional(),
    display: fhirString.optional(),
    userSelected: z.boolean().optional(),
  })
  .strict();

export const codeableConceptSchema = z
  .object({
    coding: z.array(codingSchema).optional(),
    text: fhirString.optional(),
    extension: z.array(extensionSchema).optional(),
  })
  .strict();

export const identifierSchema = z
  .object({
    use: z.enum(["usual", "official", "temp", "secondary", "old"]).optional(),
    system: fhirUri.optional(),
    value: fhirString.optional(),
  })
  .strict();

export const referenceSchema = z
  .object({
    reference: fhirString.optional(),
    type: fhirUri.optional(),
    identifier: identifierSchema.optional(),
    display: fhirString.optional(),
  })
  .strict()
  .refine((r) => r.reference !== undefined || r.identifier !== undefined || r.display !== undefined, {
    message: "a Reference needs at least one of reference, identifier or display",
  });

export const metaSchema = z
  .object({
    versionId: fhirId.optional(),
    lastUpdated: fhirInstant.optional(),
    source: fhirUri.optional(),
    profile: z.array(fhirUri).optional(),
  })
  .strict();

export const annotationSchema = z
  .object({
    authorString: fhirString.optional(),
    authorReference: referenceSchema.optional(),
    time: fhirDateTime.optional(),
    text: fhirString,
  })
  .strict();

export const narrativeSchema = z
  .object({
    status: z.enum(["generated", "extensions", "additional", "empty"]),
    div: fhirString,
  })
  .strict();

const resourceBase = {
  id: fhirId.optional(),
  meta: metaSchema.optional(),
  implicitRules: fhirUri.optional(),
  language: fhirCode.optional(),
  text: narrativeSchema.optional(),
  contained: z.array(z.unknown()).optional(),
  extension: z.array(extensionSchema).optional(),
  modifierExtension: z.array(extensionSchema).optional(),
};

// ---- AllergyIntolerance ---------------------------------------------------------------------

export const allergyIntoleranceReactionSchema = z
  .object({
    substance: codeableConceptSchema.optional(),
    manifestation: z.array(codeableConceptSchema).min(1, "manifestation is required (1..*)"),
    description: fhirString.optional(),
    onset: fhirDateTime.optional(),
    severity: z.enum(["mild", "moderate", "severe"]).optional(),
    exposureRoute: codeableConceptSchema.optional(),
    note: z.array(annotationSchema).optional(),
  })
  .strict();

export const allergyIntoleranceSchema = z
  .object({
    resourceType: z.literal("AllergyIntolerance"),
    ...resourceBase,
    identifier: z.array(identifierSchema).optional(),
    clinicalStatus: codeableConceptSchema.optional(),
    verificationStatus: codeableConceptSchema.optional(),
    type: z.enum(["allergy", "intolerance"]).optional(),
    category: z.array(z.enum(["food", "medication", "environment", "biologic"])).optional(),
    criticality: z.enum(["low", "high", "unable-to-assess"]).optional(),
    code: codeableConceptSchema.optional(),
    patient: referenceSchema,
    encounter: referenceSchema.optional(),
    onsetDateTime: fhirDateTime.optional(),
    onsetString: fhirString.optional(),
    recordedDate: fhirDateTime.optional(),
    recorder: referenceSchema.optional(),
    asserter: referenceSchema.optional(),
    lastOccurrence: fhirDateTime.optional(),
    note: z.array(annotationSchema).optional(),
    reaction: z.array(allergyIntoleranceReactionSchema).optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    // ait-1: clinicalStatus SHALL be present if verificationStatus is not entered-in-error.
    const verification = r.verificationStatus?.coding?.[0]?.code;
    if (verification !== "entered-in-error" && !r.clinicalStatus) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clinicalStatus"],
        message: "ait-1: clinicalStatus is required unless verificationStatus is entered-in-error",
      });
    }
  });

// ---- Provenance -------------------------------------------------------------------------

export const provenanceAgentSchema = z
  .object({
    type: codeableConceptSchema.optional(),
    role: z.array(codeableConceptSchema).optional(),
    who: referenceSchema,
    onBehalfOf: referenceSchema.optional(),
  })
  .strict();

export const provenanceEntitySchema = z
  .object({
    role: z.enum(["derivation", "revision", "quotation", "source", "removal"]),
    what: referenceSchema,
    agent: z.array(provenanceAgentSchema).optional(),
  })
  .strict();

export const provenanceSchema = z
  .object({
    resourceType: z.literal("Provenance"),
    ...resourceBase,
    target: z.array(referenceSchema).min(1, "target is required (1..*)"),
    occurredDateTime: fhirDateTime.optional(),
    recorded: fhirInstant,
    policy: z.array(fhirUri).optional(),
    location: referenceSchema.optional(),
    reason: z.array(codeableConceptSchema).optional(),
    activity: codeableConceptSchema.optional(),
    agent: z.array(provenanceAgentSchema).min(1, "agent is required (1..*)"),
    entity: z.array(provenanceEntitySchema).optional(),
  })
  .strict();

// ---- Bundle (collection) -------------------------------------------------------------------

/** Entry resources are validated individually by `validateResource`; here they only need a resourceType. */
export const bundleEntrySchema = z
  .object({
    fullUrl: fhirUri.optional(),
    resource: z.object({ resourceType: fhirString }).passthrough().optional(),
  })
  .strict();

export const bundleSchema = z
  .object({
    resourceType: z.literal("Bundle"),
    ...resourceBase,
    identifier: identifierSchema.optional(),
    type: z.enum([
      "document",
      "message",
      "transaction",
      "transaction-response",
      "batch",
      "batch-response",
      "history",
      "searchset",
      "collection",
    ]),
    timestamp: fhirInstant.optional(),
    total: z.number().int().nonnegative().optional(),
    entry: z.array(bundleEntrySchema).optional(),
  })
  .strict();

export const RESOURCE_SCHEMAS = {
  AllergyIntolerance: allergyIntoleranceSchema,
  Provenance: provenanceSchema,
  Bundle: bundleSchema,
} as const;

export type ValidatableResourceType = keyof typeof RESOURCE_SCHEMAS;

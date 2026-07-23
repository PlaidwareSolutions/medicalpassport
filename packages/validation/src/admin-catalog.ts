import { z } from "zod";

export const CATALOG_ENTITY_TYPES = [
  "ingredient",
  "manufacturer",
  "brand",
  "dosage_form",
  "route",
  "product",
  "classification",
] as const;
export type CatalogEntityType = (typeof CATALOG_ENTITY_TYPES)[number];

/** Required-fields-for-create is enforced at apply-time (service layer), not
 * here — every field below is optional so the same shape covers both a
 * full "create" proposal and a partial "update" patch, matching the
 * create/update split already used elsewhere (e.g. medication.ts). */
const ingredientDataSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  synonyms: z.array(z.string().trim().min(1).max(200)).optional(),
});

const manufacturerDataSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
});

const brandDataSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  aliases: z.array(z.string().trim().min(1).max(200)).optional(),
  manufacturerId: z.string().uuid().nullable().optional(),
});

const dosageFormDataSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
});

const routeDataSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
});

const classificationDataSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  parentId: z.string().uuid().nullable().optional(),
});

const productDataSchema = z.object({
  brandId: z.string().uuid().nullable().optional(),
  genericName: z.string().trim().min(1).max(200).optional(),
  dosageFormId: z.string().uuid().nullable().optional(),
  routeId: z.string().uuid().nullable().optional(),
  releaseType: z.enum(["immediate", "sustained", "extended", "controlled", "unspecified"]).optional(),
  isCombination: z.boolean().optional(),
  strengthLabel: z.string().trim().max(120).nullable().optional(),
  regulatoryRef: z.string().trim().max(200).nullable().optional(),
  sourceName: z.string().trim().max(200).nullable().optional(),
  sourceVersion: z.string().trim().max(60).nullable().optional(),
});

/** Entity types with no CatalogStatus column — "deprecate" is meaningless for them. */
const DEPRECATABLE_ENTITY_TYPES = new Set<CatalogEntityType>(["ingredient", "manufacturer", "brand", "product"]);

const DECPRECATABLE_OPERATIONS = z.enum(["create", "update", "deprecate"]);
const NON_DEPRECATABLE_OPERATIONS = z.enum(["create", "update"]);

export const proposeCatalogChangeSchema = z.discriminatedUnion("entityType", [
  z.object({ entityType: z.literal("ingredient"), operation: DECPRECATABLE_OPERATIONS, entityId: z.string().uuid().optional(), proposedData: ingredientDataSchema }),
  z.object({ entityType: z.literal("manufacturer"), operation: DECPRECATABLE_OPERATIONS, entityId: z.string().uuid().optional(), proposedData: manufacturerDataSchema }),
  z.object({ entityType: z.literal("brand"), operation: DECPRECATABLE_OPERATIONS, entityId: z.string().uuid().optional(), proposedData: brandDataSchema }),
  z.object({ entityType: z.literal("dosage_form"), operation: NON_DEPRECATABLE_OPERATIONS, entityId: z.string().uuid().optional(), proposedData: dosageFormDataSchema }),
  z.object({ entityType: z.literal("route"), operation: NON_DEPRECATABLE_OPERATIONS, entityId: z.string().uuid().optional(), proposedData: routeDataSchema }),
  z.object({ entityType: z.literal("product"), operation: DECPRECATABLE_OPERATIONS, entityId: z.string().uuid().optional(), proposedData: productDataSchema }),
  z.object({ entityType: z.literal("classification"), operation: NON_DEPRECATABLE_OPERATIONS, entityId: z.string().uuid().optional(), proposedData: classificationDataSchema }),
]).superRefine((v, ctx) => {
  if (v.operation !== "create" && !v.entityId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["entityId"], message: "entityId is required for update/deprecate" });
  }
  if (v.operation === "create" && v.entityId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["entityId"], message: "entityId must not be set for create" });
  }
});
export type ProposeCatalogChangeInput = z.infer<typeof proposeCatalogChangeSchema>;

export { DEPRECATABLE_ENTITY_TYPES };

export const decideCatalogChangeSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  rejectionReason: z.string().trim().max(500).optional(),
});
export type DecideCatalogChangeInput = z.infer<typeof decideCatalogChangeSchema>;

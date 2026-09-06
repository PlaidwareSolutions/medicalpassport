/**
 * Extraction target catalogue (docs_v2/09 §5): which entity/field pairs a candidate may
 * propose, and the shape of each proposed value. Mirrors docs_v2/04 §7.5 — `targetEntity`
 * + `targetField` validated per entity.
 *
 * Value conventions:
 *  - dates are ISO strings (`YYYY-MM-DD`; timestamps `YYYY-MM-DDTHH:mm[:ss][Z|±hh:mm]`)
 *  - strengths / quantities with a unit are `{ value: "500", unit: "mg" }` — the number stays
 *    a string exactly as printed; conversion is never silent (H-35)
 *  - free text is trimmed and length-capped
 */
import { z } from "zod";
import type { ExtractionCandidateDraft } from "./types.js";

export const TARGET_ENTITIES = [
  "prescription",
  "practitioner",
  "organization",
  "medication",
  "diagnostic_report",
  "diagnostic_result",
  "encounter",
  "condition",
  "allergy",
  "immunization",
] as const;
export type TargetEntity = (typeof TARGET_ENTITIES)[number];

// ---------------------------------------------------------------------------
// Value primitives
// ---------------------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/;

function isRealCalendarDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** `YYYY-MM-DD`, must be a real calendar date. */
export const isoDateSchema = z
  .string()
  .regex(ISO_DATE, "expected YYYY-MM-DD")
  .refine((s) => {
    const m = ISO_DATE.exec(s);
    return m !== null && isRealCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
  }, "not a real calendar date");

/** Either a date or a timestamp. */
export const isoDateOrDateTimeSchema = z.union([
  isoDateSchema,
  z
    .string()
    .regex(ISO_DATE_TIME, "expected ISO-8601 date-time")
    .refine((s) => {
      const m = ISO_DATE_TIME.exec(s);
      return m !== null && isRealCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
    }, "not a real calendar date"),
]);

/** A number kept as printed plus its unit — `"500 mg"` → `{ value: "500", unit: "mg" }`. */
export const quantityWithUnitSchema = z.object({
  value: z.string().regex(/^\d+(\.\d+)?$/, "numeric string"),
  unit: z.string().trim().min(1).max(20),
});
export type QuantityWithUnit = z.infer<typeof quantityWithUnitSchema>;

/** Parses `"500 mg"`, `"2.5mg"`, `"10 ml"`; returns null when there is no `<number><unit>` shape. */
export function parseQuantityWithUnit(text: string): QuantityWithUnit | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([A-Za-zµ%][A-Za-z0-9µ/%^.]*)\s*$/.exec(text);
  if (!m || !m[1] || !m[2]) return null;
  return { value: m[1], unit: normalizeUnit(m[2]) };
}

/** Canonical spelling for the handful of units that OCR renders inconsistently; others pass through. */
export function normalizeUnit(unit: string): string {
  const u = unit.trim();
  const lower = u.toLowerCase();
  if (lower === "µg" || lower === "ug" || lower === "mcg") return "mcg";
  if (lower === "mg" || lower === "g" || lower === "ml" || lower === "kg" || lower === "l") return lower;
  if (lower === "iu" || lower === "i.u." || lower === "units") return "IU";
  return u;
}

const text = (max: number) => z.string().trim().min(1).max(max);

/** Frequency codes an extractor may propose (subset of the domain enum; the rest need patient setup). */
export const PROPOSABLE_FREQUENCY_CODES = ["OD", "BD", "TDS", "QID", "SOS", "HS", "PATTERN"] as const;
export type ProposableFrequencyCode = (typeof PROPOSABLE_FREQUENCY_CODES)[number];

export const frequencyValueSchema = z
  .object({
    code: z.enum(PROPOSABLE_FREQUENCY_CODES),
    /** Morning-noon-night pattern such as "1-0-1"; required for PATTERN. */
    pattern: z
      .string()
      .regex(/^\d(\.\d)?-\d(\.\d)?-\d(\.\d)?$/)
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.code === "PATTERN" && !v.pattern) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pattern"], message: "PATTERN requires a pattern" });
    }
    if (v.code !== "PATTERN" && v.pattern) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pattern"], message: "only PATTERN carries a pattern" });
    }
  });
export type FrequencyValue = z.infer<typeof frequencyValueSchema>;

export const FOOD_INSTRUCTIONS = ["before", "with", "after", "any", "bedtime"] as const;
export type FoodInstructionValue = (typeof FOOD_INSTRUCTIONS)[number];

export const MEDICATION_FORMS = [
  "tablet",
  "capsule",
  "syrup",
  "suspension",
  "injection",
  "drops",
  "cream",
  "ointment",
  "gel",
  "inhaler",
  "sachet",
  "powder",
  "lotion",
  "other",
] as const;
export type MedicationFormValue = (typeof MEDICATION_FORMS)[number];

export const MEDICATION_ROUTES = [
  "oral",
  "topical",
  "inhalation",
  "injection",
  "ophthalmic",
  "otic",
  "nasal",
  "rectal",
  "sublingual",
  "other",
] as const;

export const RESULT_COMPARATORS = ["<", "<=", ">", ">="] as const;

export const ENCOUNTER_KINDS = ["outpatient", "inpatient", "emergency", "teleconsultation", "day_care", "other"] as const;

/** Catalog product reference for a brand-name proposal (the caller's matcher resolves it). */
export const brandNameValueSchema = z.object({
  productId: text(64),
  label: text(120),
});

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

export const EXTRACTION_TARGETS = {
  prescription: {
    prescribedAt: isoDateSchema,
    diagnosisText: text(500),
    validUntil: isoDateSchema,
    followUpOn: isoDateSchema,
  },
  practitioner: {
    displayName: text(120),
    speciality: text(80),
    registrationNumber: text(40),
  },
  organization: {
    displayName: text(160),
    city: text(80),
  },
  medication: {
    brandName: brandNameValueSchema,
    genericName: text(160),
    strengthLabel: quantityWithUnitSchema,
    form: z.enum(MEDICATION_FORMS),
    route: z.enum(MEDICATION_ROUTES),
    frequency: frequencyValueSchema,
    foodInstruction: z.enum(FOOD_INSTRUCTIONS),
    durationDays: z.number().int().positive().max(365),
    instructionsText: text(500),
    /** Present in the catalogue for V2.1 (printed only); NEVER proposable in V2.0 — see NEVER_AUTO_PROPOSED. */
    doseQuantity: z.number().positive().max(100),
  },
  diagnostic_report: {
    title: text(160),
    testedAt: isoDateOrDateTimeSchema,
    reportedAt: isoDateOrDateTimeSchema,
    specimenCollectedAt: isoDateOrDateTimeSchema,
    labName: text(160),
  },
  diagnostic_result: {
    /** Exactly as printed; normalization to `analyteKey` is a separate candidate. */
    analyteLabelText: text(120),
    analyteKey: text(64),
    /** Exactly as printed — numeric or qualitative ("Negative"). Never converted. */
    enteredValueText: text(40),
    enteredUnit: text(24),
    /** The lab's own printed reference range, display-only. */
    referenceText: text(120),
    comparator: z.enum(RESULT_COMPARATORS),
    /** NEVER proposable: only the lab's own flag is ever copied, as text (docs_v2/09 §5). */
    interpretation: text(40),
  },
  encounter: {
    kind: z.enum(ENCOUNTER_KINDS),
    startedAt: isoDateOrDateTimeSchema,
    endedAt: isoDateOrDateTimeSchema,
    reasonText: text(500),
  },
  condition: {
    label: text(200),
  },
  allergy: {
    label: text(200),
  },
  immunization: {
    vaccineText: text(160),
    administeredOn: isoDateSchema,
    doseNumber: z.number().int().positive().max(20),
  },
} as const satisfies Record<TargetEntity, Record<string, z.ZodTypeAny>>;

export type TargetFieldOf<E extends TargetEntity> = keyof (typeof EXTRACTION_TARGETS)[E] & string;

/** Every (entity, field) pair, for exhaustive tests and UI catalogues. */
export function listExtractionTargets(): Array<{ entity: TargetEntity; field: string }> {
  return TARGET_ENTITIES.flatMap((entity) => Object.keys(EXTRACTION_TARGETS[entity]).map((field) => ({ entity, field })));
}

export function isTargetEntity(entity: string): entity is TargetEntity {
  return (TARGET_ENTITIES as readonly string[]).includes(entity);
}

export function valueSchemaFor(entity: string, field: string): z.ZodTypeAny | undefined {
  if (!isTargetEntity(entity)) return undefined;
  const fields = EXTRACTION_TARGETS[entity] as Record<string, z.ZodTypeAny>;
  return Object.prototype.hasOwnProperty.call(fields, field) ? fields[field] : undefined;
}

// ---------------------------------------------------------------------------
// Never auto-proposed (docs_v2/09 §1 rule 4, §5; hazards H-02 / H-35)
// ---------------------------------------------------------------------------

/**
 * Fields that no extractor — deterministic or model — may ever propose. Dose quantity from a
 * photo is a V1 hazard rule (H-02) that only Gate 5 evidence can relax (V2.1, printed only);
 * a lab interpretation is a clinical judgement that never comes from the pipeline.
 */
export const NEVER_AUTO_PROPOSED: Readonly<Partial<Record<TargetEntity, readonly string[]>>> = Object.freeze({
  medication: Object.freeze(["doseQuantity"]),
  diagnostic_result: Object.freeze(["interpretation"]),
});

export class NeverAutoProposedError extends Error {
  constructor(
    public readonly entity: string,
    public readonly field: string,
  ) {
    super(`${entity}.${field} must never be auto-proposed (docs_v2/09 §5)`);
    this.name = "NeverAutoProposedError";
  }
}

export class UnknownExtractionTargetError extends Error {
  constructor(
    public readonly entity: string,
    public readonly field: string,
  ) {
    super(`${entity}.${field} is not an extraction target (docs_v2/09 §5)`);
    this.name = "UnknownExtractionTargetError";
  }
}

export function isProposable(entity: string, field: string): boolean {
  if (!isTargetEntity(entity)) return false;
  if (valueSchemaFor(entity, field) === undefined) return false;
  return !(NEVER_AUTO_PROPOSED[entity] ?? []).includes(field);
}

/** Throws unless (entity, field) is a known target that may be proposed. */
export function assertProposable(entity: string, field: string): void {
  if (!isTargetEntity(entity) || valueSchemaFor(entity, field) === undefined) {
    throw new UnknownExtractionTargetError(entity, field);
  }
  if ((NEVER_AUTO_PROPOSED[entity] ?? []).includes(field)) {
    throw new NeverAutoProposedError(entity, field);
  }
}

// ---------------------------------------------------------------------------
// Draft validation
// ---------------------------------------------------------------------------

const boundingBoxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0).max(1),
    h: z.number().min(0).max(1),
  })
  .refine((b) => b.x + b.w <= 1.0001 && b.y + b.h <= 1.0001, "bounding box exceeds the page");

const extractorIdentitySchema = z.object({ name: text(80), version: text(40) });

const modelProvenanceSchema = z.object({
  provider: text(80),
  model: text(120),
  version: text(80),
  promptVersion: text(80),
});

/** Structural shape of a draft; the value is checked separately against the catalogue. */
export const candidateDraftShapeSchema = z.object({
  targetEntity: z.string().min(1),
  targetField: z.string().min(1),
  pageNumber: z.number().int().positive(),
  boundingBox: boundingBoxSchema.optional(),
  detectedText: z.string().trim().min(1).max(2000),
  proposedValue: z.unknown(),
  confidence: z.number().min(0).max(1),
  extractor: extractorIdentitySchema,
  modelProvenance: modelProvenanceSchema.optional(),
  groupKey: z.string().max(120).optional(),
});

export type DraftValidation =
  | { ok: true; draft: ExtractionCandidateDraft }
  | { ok: false; reasons: string[] };

/**
 * Validates a candidate draft against the catalogue: structural shape, known target, not
 * never-auto-proposed, and the per-field value schema. Never throws.
 */
export function validateCandidateDraft(input: unknown): DraftValidation {
  const shape = candidateDraftShapeSchema.safeParse(input);
  if (!shape.success) {
    return { ok: false, reasons: shape.error.issues.map((i) => `shape:${i.path.join(".") || "$"}:${i.message}`) };
  }
  const draft = shape.data;
  const { targetEntity, targetField } = draft;
  if (!isTargetEntity(targetEntity)) return { ok: false, reasons: [`unknown_entity:${targetEntity}`] };
  const schema = valueSchemaFor(targetEntity, targetField);
  if (!schema) return { ok: false, reasons: [`unknown_field:${targetEntity}.${targetField}`] };
  if (!isProposable(targetEntity, targetField)) {
    return { ok: false, reasons: [`never_auto_proposed:${targetEntity}.${targetField}`] };
  }
  const value = schema.safeParse(draft.proposedValue);
  if (!value.success) {
    return {
      ok: false,
      reasons: value.error.issues.map((i) => `value:${targetEntity}.${targetField}${i.path.length ? "." + i.path.join(".") : ""}:${i.message}`),
    };
  }
  return { ok: true, draft: { ...draft, proposedValue: value.data } as ExtractionCandidateDraft };
}

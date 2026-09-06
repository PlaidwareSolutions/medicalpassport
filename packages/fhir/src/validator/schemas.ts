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
export const fhirDecimal = z.number().finite();
export const fhirPositiveInt = z.number().int().positive();
export const fhirUnsignedInt = z.number().int().nonnegative();
/** Attachment.url at this boundary: an opaque reference, never something a receiver could download (docs_v2/08 section 6 #15). */
export const opaqueAttachmentUrl = fhirUri.refine((u) => !/^https?:\/\//i.test(u), "attachment.url must be an opaque reference, never an http(s) URL");

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

export const referenceSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      reference: fhirString.optional(),
      type: fhirUri.optional(),
      identifier: identifierSchema.optional(),
      display: fhirString.optional(),
    })
    .strict()
    .refine((r) => r.reference !== undefined || r.identifier !== undefined || r.display !== undefined, {
      message: "a Reference needs at least one of reference, identifier or display",
    }),
);

export const identifierSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      use: z.enum(["usual", "official", "temp", "secondary", "old"]).optional(),
      type: codeableConceptSchema.optional(),
      system: fhirUri.optional(),
      value: fhirString.optional(),
      assigner: referenceSchema.optional(),
    })
    .strict(),
);

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

export const humanNameSchema = z
  .object({
    use: z.enum(["usual", "official", "temp", "nickname", "anonymous", "old", "maiden"]).optional(),
    text: fhirString.optional(),
    family: fhirString.optional(),
    given: z.array(fhirString).optional(),
    prefix: z.array(fhirString).optional(),
    suffix: z.array(fhirString).optional(),
  })
  .strict();

export const addressSchema = z
  .object({
    use: z.enum(["home", "work", "temp", "old", "billing"]).optional(),
    type: z.enum(["postal", "physical", "both"]).optional(),
    text: fhirString.optional(),
    line: z.array(fhirString).optional(),
    city: fhirString.optional(),
    district: fhirString.optional(),
    state: fhirString.optional(),
    postalCode: fhirString.optional(),
    country: fhirString.optional(),
  })
  .strict();

export const periodSchema = z
  .object({ start: fhirDateTime.optional(), end: fhirDateTime.optional() })
  .strict();

export const quantitySchema = z
  .object({
    value: fhirDecimal.optional(),
    comparator: z.enum(["<", "<=", ">=", ">"]).optional(),
    unit: fhirString.optional(),
    system: fhirUri.optional(),
    code: fhirCode.optional(),
  })
  .strict()
  .refine((q) => q.code === undefined || q.system !== undefined, { message: "qty-3: a Quantity with a code needs a system" });

export const rangeSchema = z.object({ low: quantitySchema.optional(), high: quantitySchema.optional() }).strict();
export const ratioSchema = z.object({ numerator: quantitySchema.optional(), denominator: quantitySchema.optional() }).strict();

export const attachmentSchema = z
  .object({
    contentType: fhirCode.optional(),
    language: fhirCode.optional(),
    url: opaqueAttachmentUrl.optional(),
    size: fhirUnsignedInt.optional(),
    hash: fhirString.optional(),
    title: fhirString.optional(),
    creation: fhirDateTime.optional(),
  })
  .strict();

const unitsOfTime = z.enum(["s", "min", "h", "d", "wk", "mo", "a"]);

export const timingRepeatSchema = z
  .object({
    boundsDuration: quantitySchema.optional(),
    boundsPeriod: periodSchema.optional(),
    count: fhirPositiveInt.optional(),
    duration: fhirDecimal.optional(),
    durationUnit: unitsOfTime.optional(),
    frequency: fhirPositiveInt.optional(),
    frequencyMax: fhirPositiveInt.optional(),
    period: fhirDecimal.optional(),
    periodMax: fhirDecimal.optional(),
    periodUnit: unitsOfTime.optional(),
    dayOfWeek: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).optional(),
    timeOfDay: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)).optional(),
    when: z
      .array(z.enum(["MORN", "MORN.early", "MORN.late", "NOON", "AFT", "AFT.early", "AFT.late", "EVE", "EVE.early", "EVE.late", "NIGHT", "PHS", "HS", "WAKE", "C", "CM", "CD", "CV", "AC", "ACM", "ACD", "ACV", "PC", "PCM", "PCD", "PCV"]))
      .optional(),
    offset: fhirUnsignedInt.optional(),
  })
  .strict()
  .refine((r) => r.period === undefined || r.periodUnit !== undefined, { message: "tim-6: a period needs a periodUnit" })
  .refine((r) => r.duration === undefined || r.durationUnit !== undefined, { message: "tim-1: a duration needs a durationUnit" });

export const timingSchema = z
  .object({
    event: z.array(fhirDateTime).optional(),
    repeat: timingRepeatSchema.optional(),
    code: codeableConceptSchema.optional(),
  })
  .strict();

export const doseAndRateSchema = z
  .object({
    type: codeableConceptSchema.optional(),
    doseQuantity: quantitySchema.optional(),
    doseRange: rangeSchema.optional(),
  })
  .strict();

export const dosageSchema = z
  .object({
    sequence: z.number().int().optional(),
    text: fhirString.optional(),
    additionalInstruction: z.array(codeableConceptSchema).optional(),
    patientInstruction: fhirString.optional(),
    timing: timingSchema.optional(),
    asNeededBoolean: z.boolean().optional(),
    site: codeableConceptSchema.optional(),
    route: codeableConceptSchema.optional(),
    method: codeableConceptSchema.optional(),
    doseAndRate: z.array(doseAndRateSchema).optional(),
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

// ---- Patient / Practitioner / Organization ----------------------------------------------------

export const patientSchema = z
  .object({
    resourceType: z.literal("Patient"),
    ...resourceBase,
    identifier: z.array(identifierSchema).optional(),
    active: z.boolean().optional(),
    name: z.array(humanNameSchema).min(1, "NRCeS Patient: name is required (1..*)"),
    gender: z.enum(["male", "female", "other", "unknown"]).optional(),
    birthDate: fhirDate.optional(),
    address: z.array(addressSchema).optional(),
    managingOrganization: referenceSchema.optional(),
  })
  .strict();

export const practitionerQualificationSchema = z
  .object({
    identifier: z.array(identifierSchema).optional(),
    code: codeableConceptSchema,
    period: periodSchema.optional(),
    issuer: referenceSchema.optional(),
  })
  .strict();

export const practitionerSchema = z
  .object({
    resourceType: z.literal("Practitioner"),
    ...resourceBase,
    identifier: z.array(identifierSchema).min(1, "NRCeS Practitioner: identifier is required (1..*)"),
    active: z.boolean().optional(),
    name: z.array(humanNameSchema).min(1, "NRCeS Practitioner: name is required (1..*)"),
    qualification: z.array(practitionerQualificationSchema).optional(),
  })
  .strict();

export const organizationSchema = z
  .object({
    resourceType: z.literal("Organization"),
    ...resourceBase,
    identifier: z.array(identifierSchema).min(1, "NRCeS Organization: identifier is required (1..*)"),
    active: z.boolean().optional(),
    type: z.array(codeableConceptSchema).optional(),
    name: fhirString,
    alias: z.array(fhirString).optional(),
    address: z.array(addressSchema).optional(),
    partOf: referenceSchema.optional(),
  })
  .strict();

// ---- Medication family --------------------------------------------------------------------

export const medicationIngredientSchema = z
  .object({
    itemCodeableConcept: codeableConceptSchema.optional(),
    itemReference: referenceSchema.optional(),
    isActive: z.boolean().optional(),
    strength: ratioSchema.optional(),
  })
  .strict()
  .refine((i) => (i.itemCodeableConcept === undefined) !== (i.itemReference === undefined), { message: "ingredient.item[x]: exactly one of itemCodeableConcept / itemReference" });

export const medicationSchema = z
  .object({
    resourceType: z.literal("Medication"),
    ...resourceBase,
    identifier: z.array(identifierSchema).optional(),
    code: codeableConceptSchema,
    status: z.enum(["active", "inactive", "entered-in-error"]).optional(),
    manufacturer: referenceSchema.optional(),
    form: codeableConceptSchema.optional(),
    ingredient: z.array(medicationIngredientSchema).optional(),
  })
  .strict();

const medicationChoice = <T extends { medicationCodeableConcept?: unknown; medicationReference?: unknown }>(r: T) =>
  (r.medicationCodeableConcept === undefined) !== (r.medicationReference === undefined);

export const medicationRequestSchema = z
  .object({
    resourceType: z.literal("MedicationRequest"),
    ...resourceBase,
    identifier: z.array(identifierSchema).optional(),
    status: z.enum(["active", "on-hold", "cancelled", "completed", "entered-in-error", "stopped", "draft", "unknown"]),
    statusReason: codeableConceptSchema.optional(),
    intent: z.enum(["proposal", "plan", "order", "original-order", "reflex-order", "filler-order", "instance-order", "option"]),
    category: z.array(codeableConceptSchema).optional(),
    priority: z.enum(["routine", "urgent", "asap", "stat"]).optional(),
    medicationCodeableConcept: codeableConceptSchema.optional(),
    medicationReference: referenceSchema.optional(),
    subject: referenceSchema,
    encounter: referenceSchema.optional(),
    authoredOn: fhirDateTime.optional(),
    requester: referenceSchema.optional(),
    recorder: referenceSchema.optional(),
    reasonCode: z.array(codeableConceptSchema).optional(),
    reasonReference: z.array(referenceSchema).optional(),
    groupIdentifier: identifierSchema.optional(),
    note: z.array(annotationSchema).optional(),
    dosageInstruction: z.array(dosageSchema).optional(),
  })
  .strict()
  .refine(medicationChoice, { message: "medication[x]: exactly one of medicationCodeableConcept / medicationReference", path: ["medicationCodeableConcept"] });

export const medicationStatementSchema = z
  .object({
    resourceType: z.literal("MedicationStatement"),
    ...resourceBase,
    identifier: z.array(identifierSchema).optional(),
    basedOn: z.array(referenceSchema).optional(),
    status: z.enum(["active", "completed", "entered-in-error", "intended", "stopped", "on-hold", "unknown", "not-taken"]),
    statusReason: z.array(codeableConceptSchema).optional(),
    category: codeableConceptSchema.optional(),
    medicationCodeableConcept: codeableConceptSchema.optional(),
    medicationReference: referenceSchema.optional(),
    subject: referenceSchema,
    context: referenceSchema.optional(),
    effectiveDateTime: fhirDateTime.optional(),
    effectivePeriod: periodSchema.optional(),
    dateAsserted: fhirDateTime.optional(),
    informationSource: referenceSchema.optional(),
    derivedFrom: z.array(referenceSchema).optional(),
    reasonCode: z.array(codeableConceptSchema).optional(),
    reasonReference: z.array(referenceSchema).optional(),
    note: z.array(annotationSchema).optional(),
    dosage: z.array(dosageSchema).optional(),
  })
  .strict()
  .refine(medicationChoice, { message: "medication[x]: exactly one of medicationCodeableConcept / medicationReference", path: ["medicationCodeableConcept"] });

// ---- Diagnostics --------------------------------------------------------------------------

export const diagnosticReportSchema = z
  .object({
    resourceType: z.literal("DiagnosticReport"),
    ...resourceBase,
    identifier: z.array(identifierSchema).optional(),
    basedOn: z.array(referenceSchema).optional(),
    status: z.enum(["registered", "partial", "preliminary", "final", "amended", "corrected", "appended", "cancelled", "entered-in-error", "unknown"]),
    category: z.array(codeableConceptSchema).optional(),
    code: codeableConceptSchema,
    subject: referenceSchema.optional(),
    encounter: referenceSchema.optional(),
    effectiveDateTime: fhirDateTime.optional(),
    effectivePeriod: periodSchema.optional(),
    issued: fhirInstant.optional(),
    performer: z.array(referenceSchema).optional(),
    resultsInterpreter: z.array(referenceSchema).optional(),
    specimen: z.array(referenceSchema).optional(),
    result: z.array(referenceSchema).optional(),
    imagingStudy: z.array(referenceSchema).optional(),
    conclusion: fhirString.optional(),
    conclusionCode: z.array(codeableConceptSchema).optional(),
    presentedForm: z.array(attachmentSchema).optional(),
  })
  .strict();

export const observationReferenceRangeSchema = z
  .object({
    low: quantitySchema.optional(),
    high: quantitySchema.optional(),
    type: codeableConceptSchema.optional(),
    text: fhirString.optional(),
  })
  .strict()
  .refine((r) => r.low !== undefined || r.high !== undefined || r.text !== undefined, { message: "obs-3: a referenceRange needs low, high or text" });

export const observationComponentSchema = z
  .object({
    code: codeableConceptSchema,
    valueQuantity: quantitySchema.optional(),
    valueString: fhirString.optional(),
    valueCodeableConcept: codeableConceptSchema.optional(),
    dataAbsentReason: codeableConceptSchema.optional(),
    interpretation: z.array(codeableConceptSchema).optional(),
    referenceRange: z.array(observationReferenceRangeSchema).optional(),
  })
  .strict();

export const observationSchema = z
  .object({
    resourceType: z.literal("Observation"),
    ...resourceBase,
    identifier: z.array(identifierSchema).optional(),
    basedOn: z.array(referenceSchema).optional(),
    partOf: z.array(referenceSchema).optional(),
    status: z.enum(["registered", "preliminary", "final", "amended", "corrected", "cancelled", "entered-in-error", "unknown"]),
    category: z.array(codeableConceptSchema).optional(),
    code: codeableConceptSchema,
    subject: referenceSchema.optional(),
    encounter: referenceSchema.optional(),
    effectiveDateTime: fhirDateTime.optional(),
    effectivePeriod: periodSchema.optional(),
    issued: fhirInstant.optional(),
    performer: z.array(referenceSchema).optional(),
    valueQuantity: quantitySchema.optional(),
    valueString: fhirString.optional(),
    valueCodeableConcept: codeableConceptSchema.optional(),
    dataAbsentReason: codeableConceptSchema.optional(),
    interpretation: z.array(codeableConceptSchema).optional(),
    note: z.array(annotationSchema).optional(),
    bodySite: codeableConceptSchema.optional(),
    method: codeableConceptSchema.optional(),
    specimen: referenceSchema.optional(),
    device: referenceSchema.optional(),
    referenceRange: z.array(observationReferenceRangeSchema).optional(),
    hasMember: z.array(referenceSchema).optional(),
    derivedFrom: z.array(referenceSchema).optional(),
    component: z.array(observationComponentSchema).optional(),
  })
  .strict()
  .superRefine((o, ctx) => {
    const hasValue = o.valueQuantity !== undefined || o.valueString !== undefined || o.valueCodeableConcept !== undefined;
    if (hasValue && o.dataAbsentReason !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dataAbsentReason"], message: "obs-6: dataAbsentReason SHALL only be present if value[x] is absent" });
    }
    // vs-2 (vital-signs profile): a vital sign without a value needs components or a dataAbsentReason.
    const vitalSigns = o.meta?.profile?.some((p) => /vitalsigns$|StructureDefinition\/Observation(BP|BodyWeight|HeartRate|OxygenSat)$/.test(p));
    if (vitalSigns) {
      if (!o.effectiveDateTime && !o.effectivePeriod) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["effectiveDateTime"], message: "vs-1: vital signs need effective[x]" });
      }
      if (!hasValue && !(o.component && o.component.length > 0) && o.dataAbsentReason === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["valueQuantity"], message: "vs-2: a vital sign needs a value, components, or a dataAbsentReason" });
      }
      if (!o.category?.some((c) => c.coding?.some((x) => x.code === "vital-signs"))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["category"], message: "vital-signs profile: category vital-signs is required" });
      }
    }
  });

// ---- Condition ----------------------------------------------------------------------------

export const conditionSchema = z
  .object({
    resourceType: z.literal("Condition"),
    ...resourceBase,
    identifier: z.array(identifierSchema).optional(),
    clinicalStatus: codeableConceptSchema.optional(),
    verificationStatus: codeableConceptSchema.optional(),
    category: z.array(codeableConceptSchema).optional(),
    severity: codeableConceptSchema.optional(),
    code: codeableConceptSchema.optional(),
    bodySite: z.array(codeableConceptSchema).optional(),
    subject: referenceSchema,
    encounter: referenceSchema.optional(),
    onsetDateTime: fhirDateTime.optional(),
    onsetString: fhirString.optional(),
    abatementDateTime: fhirDateTime.optional(),
    abatementString: fhirString.optional(),
    recordedDate: fhirDateTime.optional(),
    recorder: referenceSchema.optional(),
    asserter: referenceSchema.optional(),
    note: z.array(annotationSchema).optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    // con-3: clinicalStatus SHALL be present if verificationStatus is not entered-in-error and category is problem-list-item.
    const verification = c.verificationStatus?.coding?.[0]?.code;
    const problemList = c.category?.some((cat) => cat.coding?.some((x) => x.code === "problem-list-item"));
    if (verification !== "entered-in-error" && problemList && !c.clinicalStatus) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["clinicalStatus"], message: "con-3: clinicalStatus is required for a problem-list-item unless entered-in-error" });
    }
    // con-4: abatement only when clinicalStatus is inactive/resolved/remission (or absent).
    const clinical = c.clinicalStatus?.coding?.[0]?.code;
    if ((c.abatementDateTime || c.abatementString) && clinical && !["inactive", "resolved", "remission"].includes(clinical)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["abatementDateTime"], message: "con-4: abatement[x] only for inactive/resolved/remission conditions" });
    }
  });

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

// ---- DocumentReference / Composition ---------------------------------------------------------

export const documentReferenceContentSchema = z
  .object({ attachment: attachmentSchema, format: codingSchema.optional() })
  .strict();

export const documentReferenceContextSchema = z
  .object({
    encounter: z.array(referenceSchema).optional(),
    period: periodSchema.optional(),
    related: z.array(referenceSchema).optional(),
  })
  .strict();

export const documentReferenceSchema = z
  .object({
    resourceType: z.literal("DocumentReference"),
    ...resourceBase,
    masterIdentifier: identifierSchema.optional(),
    identifier: z.array(identifierSchema).optional(),
    status: z.enum(["current", "superseded", "entered-in-error"]),
    docStatus: z.enum(["preliminary", "final", "amended", "entered-in-error"]).optional(),
    type: codeableConceptSchema.optional(),
    category: z.array(codeableConceptSchema).optional(),
    subject: referenceSchema.optional(),
    date: fhirInstant.optional(),
    author: z.array(referenceSchema).optional(),
    custodian: referenceSchema.optional(),
    description: fhirString.optional(),
    content: z.array(documentReferenceContentSchema).min(1, "content is required (1..*)"),
    context: documentReferenceContextSchema.optional(),
  })
  .strict();

export const compositionSectionSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      title: fhirString.optional(),
      code: codeableConceptSchema.optional(),
      author: z.array(referenceSchema).optional(),
      text: narrativeSchema.optional(),
      mode: z.enum(["working", "snapshot", "changes"]).optional(),
      orderedBy: codeableConceptSchema.optional(),
      entry: z.array(referenceSchema).optional(),
      emptyReason: codeableConceptSchema.optional(),
      section: z.array(compositionSectionSchema).optional(),
    })
    .strict()
    .refine((s) => !(s.emptyReason !== undefined && s.entry !== undefined && s.entry.length > 0), { message: "cmp-2: a section cannot have both entries and an emptyReason" })
    .refine((s) => s.text !== undefined || (s.entry !== undefined && s.entry.length > 0) || (s.section !== undefined && s.section.length > 0) || s.emptyReason !== undefined, {
      message: "cmp-1: a section must have text, entries, sub-sections or an emptyReason",
    }),
);

export const compositionSchema = z
  .object({
    resourceType: z.literal("Composition"),
    ...resourceBase,
    identifier: identifierSchema.optional(),
    status: z.enum(["preliminary", "final", "amended", "entered-in-error"]),
    type: codeableConceptSchema,
    category: z.array(codeableConceptSchema).optional(),
    subject: referenceSchema.optional(),
    encounter: referenceSchema.optional(),
    date: fhirDateTime,
    author: z.array(referenceSchema).min(1, "author is required (1..*)"),
    title: fhirString,
    confidentiality: fhirCode.optional(),
    custodian: referenceSchema.optional(),
    section: z.array(compositionSectionSchema).optional(),
  })
  .strict();

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

// ---- Bundle -------------------------------------------------------------------------------

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
  Condition: conditionSchema,
  Patient: patientSchema,
  Practitioner: practitionerSchema,
  Organization: organizationSchema,
  Medication: medicationSchema,
  MedicationRequest: medicationRequestSchema,
  MedicationStatement: medicationStatementSchema,
  DiagnosticReport: diagnosticReportSchema,
  Observation: observationSchema,
  DocumentReference: documentReferenceSchema,
  Composition: compositionSchema,
  Provenance: provenanceSchema,
  Bundle: bundleSchema,
} as const;

export type ValidatableResourceType = keyof typeof RESOURCE_SCHEMAS;

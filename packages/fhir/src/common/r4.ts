/**
 * Minimal FHIR R4 (4.0.1) resource shapes produced/consumed by this package.
 * Hand-written on purpose: no runtime dependency on FHIR npm packages (ADR-V2-003).
 */

export const FHIR_VERSION = "4.0.1" as const;

export interface Extension {
  url: string;
  valueCode?: string;
  valueString?: string;
  valueUri?: string;
  valueBoolean?: boolean;
  valueDateTime?: string;
}

export interface Coding {
  system?: string;
  version?: string;
  code?: string;
  display?: string;
  userSelected?: boolean;
}

export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
  extension?: Extension[];
}

export interface Identifier {
  use?: "usual" | "official" | "temp" | "secondary" | "old";
  system?: string;
  value?: string;
}

export interface Reference {
  reference?: string;
  type?: string;
  identifier?: Identifier;
  display?: string;
}

export interface Meta {
  versionId?: string;
  lastUpdated?: string;
  source?: string;
  profile?: string[];
}

export interface Annotation {
  authorString?: string;
  authorReference?: Reference;
  time?: string;
  text: string;
}

export interface Narrative {
  status: "generated" | "extensions" | "additional" | "empty";
  div: string;
}

export interface ResourceBase {
  resourceType: string;
  id?: string;
  meta?: Meta;
  implicitRules?: string;
  language?: string;
  text?: Narrative;
  extension?: Extension[];
  modifierExtension?: Extension[];
}

export interface AllergyIntoleranceReaction {
  substance?: CodeableConcept;
  manifestation: CodeableConcept[];
  description?: string;
  onset?: string;
  severity?: "mild" | "moderate" | "severe";
  exposureRoute?: CodeableConcept;
  note?: Annotation[];
}

export interface AllergyIntoleranceResource extends ResourceBase {
  resourceType: "AllergyIntolerance";
  identifier?: Identifier[];
  clinicalStatus?: CodeableConcept;
  verificationStatus?: CodeableConcept;
  type?: "allergy" | "intolerance";
  category?: Array<"food" | "medication" | "environment" | "biologic">;
  criticality?: "low" | "high" | "unable-to-assess";
  code?: CodeableConcept;
  patient: Reference;
  encounter?: Reference;
  onsetDateTime?: string;
  onsetString?: string;
  recordedDate?: string;
  recorder?: Reference;
  asserter?: Reference;
  lastOccurrence?: string;
  note?: Annotation[];
  reaction?: AllergyIntoleranceReaction[];
}

export interface ProvenanceAgent {
  type?: CodeableConcept;
  role?: CodeableConcept[];
  who: Reference;
  onBehalfOf?: Reference;
}

export interface ProvenanceEntity {
  role: "derivation" | "revision" | "quotation" | "source" | "removal";
  what: Reference;
  agent?: ProvenanceAgent[];
}

export interface ProvenanceResource extends ResourceBase {
  resourceType: "Provenance";
  target: Reference[];
  occurredDateTime?: string;
  recorded: string;
  policy?: string[];
  location?: Reference;
  reason?: CodeableConcept[];
  activity?: CodeableConcept;
  agent: ProvenanceAgent[];
  entity?: ProvenanceEntity[];
}

export interface BundleEntry<R extends ResourceBase = ResourceBase> {
  fullUrl?: string;
  resource?: R;
}

export interface BundleResource<R extends ResourceBase = ResourceBase> extends ResourceBase {
  resourceType: "Bundle";
  identifier?: Identifier;
  type:
    | "document"
    | "message"
    | "transaction"
    | "transaction-response"
    | "batch"
    | "batch-response"
    | "history"
    | "searchset"
    | "collection";
  timestamp?: string;
  total?: number;
  entry?: BundleEntry<R>[];
}

export type FhirResource = AllergyIntoleranceResource | ProvenanceResource | BundleResource;

/** Well-known code systems used at this boundary. */
export const CODE_SYSTEMS = {
  allergyClinical: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
  allergyVerification: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
  provenanceParticipantType: "http://terminology.hl7.org/CodeSystem/provenance-participant-type",
  dataAbsentReason: "http://hl7.org/fhir/StructureDefinition/data-absent-reason",
  abhaAddress: "https://healthid.ndhm.gov.in",
} as const;

/** MedicinePassport-owned identifier systems and extension URLs (stable, documented in docs_v2/08). */
export const MEDPASS_SYSTEMS = {
  user: "urn:medicinepassport:user",
  abdmTransaction: "urn:medicinepassport:abdm-transaction",
  software: "urn:medicinepassport:software",
  extRecordSource: "https://medicinepassport.app/fhir/StructureDefinition/record-source",
  extVerification: "https://medicinepassport.app/fhir/StructureDefinition/verification-state",
  extRecordedVia: "https://medicinepassport.app/fhir/StructureDefinition/recorded-via",
} as const;

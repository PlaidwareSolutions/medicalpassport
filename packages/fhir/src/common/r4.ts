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
  type?: CodeableConcept;
  system?: string;
  value?: string;
  assigner?: Reference;
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

export interface HumanName {
  use?: "usual" | "official" | "temp" | "nickname" | "anonymous" | "old" | "maiden";
  text?: string;
  family?: string;
  given?: string[];
  prefix?: string[];
  suffix?: string[];
}

export interface Address {
  use?: "home" | "work" | "temp" | "old" | "billing";
  type?: "postal" | "physical" | "both";
  text?: string;
  line?: string[];
  city?: string;
  district?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface Period {
  start?: string;
  end?: string;
}

export interface Quantity {
  value?: number;
  comparator?: "<" | "<=" | ">=" | ">";
  unit?: string;
  system?: string;
  code?: string;
}

export interface Range {
  low?: Quantity;
  high?: Quantity;
}

export interface Ratio {
  numerator?: Quantity;
  denominator?: Quantity;
}

export interface Attachment {
  contentType?: string;
  language?: string;
  /** Opaque reference (`urn:medicinepassport:stored-object:<id>`), never a fetchable URL (docs_v2/08 section 6 #15). */
  url?: string;
  size?: number;
  hash?: string;
  title?: string;
  creation?: string;
}

export interface TimingRepeat {
  boundsDuration?: Quantity;
  boundsPeriod?: Period;
  count?: number;
  duration?: number;
  durationUnit?: "s" | "min" | "h" | "d" | "wk" | "mo" | "a";
  frequency?: number;
  frequencyMax?: number;
  period?: number;
  periodMax?: number;
  periodUnit?: "s" | "min" | "h" | "d" | "wk" | "mo" | "a";
  dayOfWeek?: string[];
  timeOfDay?: string[];
  when?: string[];
  offset?: number;
}

export interface Timing {
  event?: string[];
  repeat?: TimingRepeat;
  code?: CodeableConcept;
}

export interface DoseAndRate {
  type?: CodeableConcept;
  doseQuantity?: Quantity;
  doseRange?: Range;
}

export interface Dosage {
  sequence?: number;
  text?: string;
  additionalInstruction?: CodeableConcept[];
  patientInstruction?: string;
  timing?: Timing;
  asNeededBoolean?: boolean;
  site?: CodeableConcept;
  route?: CodeableConcept;
  method?: CodeableConcept;
  doseAndRate?: DoseAndRate[];
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

// ---- Patient / Practitioner / Organization ------------------------------------------------

export interface PatientResource extends ResourceBase {
  resourceType: "Patient";
  identifier?: Identifier[];
  active?: boolean;
  name?: HumanName[];
  gender?: "male" | "female" | "other" | "unknown";
  birthDate?: string;
  address?: Address[];
  managingOrganization?: Reference;
}

export interface PractitionerQualification {
  identifier?: Identifier[];
  code: CodeableConcept;
  period?: Period;
  issuer?: Reference;
}

export interface PractitionerResource extends ResourceBase {
  resourceType: "Practitioner";
  identifier?: Identifier[];
  active?: boolean;
  name?: HumanName[];
  qualification?: PractitionerQualification[];
}

export interface OrganizationResource extends ResourceBase {
  resourceType: "Organization";
  identifier?: Identifier[];
  active?: boolean;
  type?: CodeableConcept[];
  name?: string;
  alias?: string[];
  address?: Address[];
  partOf?: Reference;
}

// ---- Medication family --------------------------------------------------------------------

export interface MedicationIngredient {
  itemCodeableConcept?: CodeableConcept;
  itemReference?: Reference;
  isActive?: boolean;
  strength?: Ratio;
}

export interface MedicationResource extends ResourceBase {
  resourceType: "Medication";
  identifier?: Identifier[];
  code?: CodeableConcept;
  status?: "active" | "inactive" | "entered-in-error";
  manufacturer?: Reference;
  form?: CodeableConcept;
  ingredient?: MedicationIngredient[];
}

export type MedicationRequestStatus =
  | "active"
  | "on-hold"
  | "cancelled"
  | "completed"
  | "entered-in-error"
  | "stopped"
  | "draft"
  | "unknown";

export interface MedicationRequestResource extends ResourceBase {
  resourceType: "MedicationRequest";
  identifier?: Identifier[];
  status: MedicationRequestStatus;
  statusReason?: CodeableConcept;
  intent: "proposal" | "plan" | "order" | "original-order" | "reflex-order" | "filler-order" | "instance-order" | "option";
  category?: CodeableConcept[];
  priority?: "routine" | "urgent" | "asap" | "stat";
  medicationCodeableConcept?: CodeableConcept;
  medicationReference?: Reference;
  subject: Reference;
  encounter?: Reference;
  authoredOn?: string;
  requester?: Reference;
  recorder?: Reference;
  reasonCode?: CodeableConcept[];
  reasonReference?: Reference[];
  groupIdentifier?: Identifier;
  note?: Annotation[];
  dosageInstruction?: Dosage[];
}

export type MedicationStatementStatus =
  | "active"
  | "completed"
  | "entered-in-error"
  | "intended"
  | "stopped"
  | "on-hold"
  | "unknown"
  | "not-taken";

export interface MedicationStatementResource extends ResourceBase {
  resourceType: "MedicationStatement";
  identifier?: Identifier[];
  basedOn?: Reference[];
  status: MedicationStatementStatus;
  statusReason?: CodeableConcept[];
  category?: CodeableConcept;
  medicationCodeableConcept?: CodeableConcept;
  medicationReference?: Reference;
  subject: Reference;
  context?: Reference;
  effectiveDateTime?: string;
  effectivePeriod?: Period;
  dateAsserted?: string;
  informationSource?: Reference;
  derivedFrom?: Reference[];
  reasonCode?: CodeableConcept[];
  reasonReference?: Reference[];
  note?: Annotation[];
  dosage?: Dosage[];
}

// ---- Diagnostics --------------------------------------------------------------------------

export type DiagnosticReportStatus =
  | "registered"
  | "partial"
  | "preliminary"
  | "final"
  | "amended"
  | "corrected"
  | "appended"
  | "cancelled"
  | "entered-in-error"
  | "unknown";

export interface DiagnosticReportResource extends ResourceBase {
  resourceType: "DiagnosticReport";
  identifier?: Identifier[];
  basedOn?: Reference[];
  status: DiagnosticReportStatus;
  category?: CodeableConcept[];
  code: CodeableConcept;
  subject?: Reference;
  encounter?: Reference;
  effectiveDateTime?: string;
  effectivePeriod?: Period;
  issued?: string;
  performer?: Reference[];
  resultsInterpreter?: Reference[];
  specimen?: Reference[];
  result?: Reference[];
  imagingStudy?: Reference[];
  conclusion?: string;
  conclusionCode?: CodeableConcept[];
  presentedForm?: Attachment[];
}

export interface ObservationReferenceRange {
  low?: Quantity;
  high?: Quantity;
  type?: CodeableConcept;
  text?: string;
}

export interface ObservationComponent {
  code: CodeableConcept;
  valueQuantity?: Quantity;
  valueString?: string;
  valueCodeableConcept?: CodeableConcept;
  dataAbsentReason?: CodeableConcept;
  interpretation?: CodeableConcept[];
  referenceRange?: ObservationReferenceRange[];
}

export type ObservationStatus =
  | "registered"
  | "preliminary"
  | "final"
  | "amended"
  | "corrected"
  | "cancelled"
  | "entered-in-error"
  | "unknown";

export interface ObservationResource extends ResourceBase {
  resourceType: "Observation";
  identifier?: Identifier[];
  basedOn?: Reference[];
  partOf?: Reference[];
  status: ObservationStatus;
  category?: CodeableConcept[];
  code: CodeableConcept;
  subject?: Reference;
  encounter?: Reference;
  effectiveDateTime?: string;
  effectivePeriod?: Period;
  issued?: string;
  performer?: Reference[];
  valueQuantity?: Quantity;
  valueString?: string;
  valueCodeableConcept?: CodeableConcept;
  dataAbsentReason?: CodeableConcept;
  interpretation?: CodeableConcept[];
  note?: Annotation[];
  bodySite?: CodeableConcept;
  method?: CodeableConcept;
  specimen?: Reference;
  device?: Reference;
  referenceRange?: ObservationReferenceRange[];
  hasMember?: Reference[];
  derivedFrom?: Reference[];
  component?: ObservationComponent[];
}

// ---- Condition / Allergy ------------------------------------------------------------------

export interface ConditionResource extends ResourceBase {
  resourceType: "Condition";
  identifier?: Identifier[];
  clinicalStatus?: CodeableConcept;
  verificationStatus?: CodeableConcept;
  category?: CodeableConcept[];
  severity?: CodeableConcept;
  code?: CodeableConcept;
  bodySite?: CodeableConcept[];
  subject: Reference;
  encounter?: Reference;
  onsetDateTime?: string;
  onsetString?: string;
  abatementDateTime?: string;
  abatementString?: string;
  recordedDate?: string;
  recorder?: Reference;
  asserter?: Reference;
  note?: Annotation[];
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

// ---- Documents ----------------------------------------------------------------------------

export interface DocumentReferenceContent {
  attachment: Attachment;
  format?: Coding;
}

export interface DocumentReferenceContext {
  encounter?: Reference[];
  period?: Period;
  related?: Reference[];
}

export interface DocumentReferenceResource extends ResourceBase {
  resourceType: "DocumentReference";
  masterIdentifier?: Identifier;
  identifier?: Identifier[];
  status: "current" | "superseded" | "entered-in-error";
  docStatus?: "preliminary" | "final" | "amended" | "entered-in-error";
  type?: CodeableConcept;
  category?: CodeableConcept[];
  subject?: Reference;
  date?: string;
  author?: Reference[];
  custodian?: Reference;
  description?: string;
  content: DocumentReferenceContent[];
  context?: DocumentReferenceContext;
}

export interface CompositionSection {
  title?: string;
  code?: CodeableConcept;
  author?: Reference[];
  text?: Narrative;
  mode?: "working" | "snapshot" | "changes";
  orderedBy?: CodeableConcept;
  entry?: Reference[];
  emptyReason?: CodeableConcept;
  section?: CompositionSection[];
}

export interface CompositionResource extends ResourceBase {
  resourceType: "Composition";
  identifier?: Identifier;
  status: "preliminary" | "final" | "amended" | "entered-in-error";
  type: CodeableConcept;
  category?: CodeableConcept[];
  subject?: Reference;
  encounter?: Reference;
  date: string;
  author: Reference[];
  title: string;
  confidentiality?: string;
  custodian?: Reference;
  section?: CompositionSection[];
}

// ---- Provenance / Bundle ------------------------------------------------------------------

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

/** Every clinical resource this package serializes (each one travels with a Provenance). */
export type ClinicalResource =
  | AllergyIntoleranceResource
  | ConditionResource
  | PatientResource
  | PractitionerResource
  | OrganizationResource
  | MedicationResource
  | MedicationRequestResource
  | MedicationStatementResource
  | DiagnosticReportResource
  | ObservationResource
  | DocumentReferenceResource
  | CompositionResource;

export type FhirResource = ClinicalResource | ProvenanceResource | BundleResource;

/** Well-known code systems used at this boundary. */
export const CODE_SYSTEMS = {
  allergyClinical: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
  allergyVerification: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
  conditionClinical: "http://terminology.hl7.org/CodeSystem/condition-clinical",
  conditionVerification: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
  conditionCategory: "http://terminology.hl7.org/CodeSystem/condition-category",
  provenanceParticipantType: "http://terminology.hl7.org/CodeSystem/provenance-participant-type",
  observationCategory: "http://terminology.hl7.org/CodeSystem/observation-category",
  diagnosticServiceSection: "http://terminology.hl7.org/CodeSystem/v2-0074",
  identifierType: "http://terminology.hl7.org/CodeSystem/v2-0203",
  organizationType: "http://terminology.hl7.org/CodeSystem/organization-type",
  observationInterpretation: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
  listEmptyReason: "http://terminology.hl7.org/CodeSystem/list-empty-reason",
  medicationStatementCategory: "http://terminology.hl7.org/CodeSystem/medication-statement-category",
  dataAbsentReason: "http://hl7.org/fhir/StructureDefinition/data-absent-reason",
  loinc: "http://loinc.org",
  snomed: "http://snomed.info/sct",
  ucum: "http://unitsofmeasure.org",
  rxnorm: "http://www.nlm.nih.gov/research/umls/rxnorm",
  dicomModality: "http://dicom.nema.org/resources/ontology/DCM",
  /** ABHA address (`name@sbx`) and ABHA number both live under the NDHM health-id authority. */
  abhaAddress: "https://healthid.ndhm.gov.in",
  abhaNumber: "https://healthid.ndhm.gov.in",
  /** Health Professional Registry / Health Facility Registry ids (set only via ABDM verification). */
  hprId: "https://hpr.abdm.gov.in",
  hfrId: "https://facility.ndhm.gov.in",
  /** Base R4 vital-signs profile every vital-sign Observation must satisfy. */
  vitalSignsProfile: "http://hl7.org/fhir/StructureDefinition/vitalsigns",
} as const;

/** MedicinePassport-owned identifier systems, code systems and extension URLs (stable, documented in docs_v2/08). */
export const MEDPASS_SYSTEMS = {
  user: "urn:medicinepassport:user",
  abdmTransaction: "urn:medicinepassport:abdm-transaction",
  software: "urn:medicinepassport:software",
  practitioner: "urn:medicinepassport:practitioner",
  organization: "urn:medicinepassport:organization",
  prescription: "urn:medicinepassport:prescription",
  diagnosticReport: "urn:medicinepassport:diagnostic-report",
  document: "urn:medicinepassport:document",
  /** Opaque attachment reference: the API resolves it to a signed URL only for an authorized caller. */
  storedObject: "urn:medicinepassport:stored-object",
  /** Local code systems used when no national/international code is mapped (docs_v2/08 section 3, section 6 #6). */
  csMedication: "https://medicinepassport.app/CodeSystem/medication",
  csAnalyte: "https://medicinepassport.app/CodeSystem/analyte",
  csObservationConcept: "https://medicinepassport.app/CodeSystem/observation-concept",
  csDocumentKind: "https://medicinepassport.app/CodeSystem/document-kind",
  csCondition: "https://medicinepassport.app/CodeSystem/condition",
  csDiagnosticReportKind: "https://medicinepassport.app/CodeSystem/diagnostic-report-kind",
  csFrequency: "https://medicinepassport.app/CodeSystem/frequency-code",
  extRecordSource: "https://medicinepassport.app/fhir/StructureDefinition/record-source",
  extVerification: "https://medicinepassport.app/fhir/StructureDefinition/verification-state",
  extRecordedVia: "https://medicinepassport.app/fhir/StructureDefinition/recorded-via",
  extBodySite: "https://medicinepassport.app/fhir/StructureDefinition/body-site",
  extEnteredValue: "https://medicinepassport.app/fhir/StructureDefinition/entered-value",
} as const;

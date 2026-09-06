/**
 * @medpass/fhir — pure canonical <-> FHIR R4 transformation and conformance layer
 * (ADR-V2-001, ADR-V2-003). No database, no Prisma, no network.
 */
export * from "./canonical/index.js";
export * from "./errors.js";
export { FHIR_VERSION, CODE_SYSTEMS, MEDPASS_SYSTEMS } from "./common/r4.js";
export type {
  Address,
  AllergyIntoleranceReaction,
  AllergyIntoleranceResource,
  Annotation,
  Attachment,
  BundleEntry,
  BundleResource,
  ClinicalResource,
  CodeableConcept,
  Coding,
  CompositionResource,
  CompositionSection,
  ConditionResource,
  DiagnosticReportResource,
  DocumentReferenceResource,
  Dosage,
  Extension,
  FhirResource,
  HumanName,
  Identifier,
  MedicationRequestResource,
  MedicationResource,
  MedicationStatementResource,
  Meta,
  ObservationComponent,
  ObservationResource,
  OrganizationResource,
  PatientResource,
  Period,
  PractitionerResource,
  ProvenanceAgent,
  ProvenanceEntity,
  ProvenanceResource,
  Quantity,
  Reference,
  ResourceBase,
  Timing,
  TimingRepeat,
} from "./common/r4.js";
export type { SerializeContext } from "./common/context.js";
export { DEFAULT_SOFTWARE_VERSION } from "./common/context.js";
export type { IgModule, ProfiledResourceType, SerializedDocument } from "./common/ig-module.js";
export type { CodecContext, SerializedResource } from "./common/failure.js";
export { referenceId } from "./common/references.js";
export { storedObjectUrn } from "./common/document-codec.js";
export { MEDICATION_STATEMENT_STATUS, patternWhen, timingRepeatFor } from "./common/medication-codec.js";
export * from "./version-mapper.js";
export * from "./bundle.js";
export * from "./validator/index.js";
export * as schemas from "./validator/schemas.js";
export * from "./serialize.js";
export * from "./parser/index.js";

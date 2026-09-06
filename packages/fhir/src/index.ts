/**
 * @medpass/fhir — pure canonical <-> FHIR R4 transformation and conformance layer
 * (ADR-V2-001, ADR-V2-003). No database, no Prisma, no network.
 */
export * from "./canonical/index.js";
export * from "./errors.js";
export { FHIR_VERSION, CODE_SYSTEMS, MEDPASS_SYSTEMS } from "./common/r4.js";
export type {
  AllergyIntoleranceReaction,
  AllergyIntoleranceResource,
  Annotation,
  BundleEntry,
  BundleResource,
  CodeableConcept,
  Coding,
  Extension,
  FhirResource,
  Identifier,
  Meta,
  ProvenanceAgent,
  ProvenanceEntity,
  ProvenanceResource,
  Reference,
  ResourceBase,
} from "./common/r4.js";
export type { SerializeContext } from "./common/context.js";
export { DEFAULT_SOFTWARE_VERSION } from "./common/context.js";
export type { IgModule, ProfiledResourceType } from "./common/ig-module.js";
export { referenceId } from "./common/references.js";
export * from "./version-mapper.js";
export * from "./bundle.js";
export * from "./validator/index.js";
export * as schemas from "./validator/schemas.js";
export * from "./serialize.js";

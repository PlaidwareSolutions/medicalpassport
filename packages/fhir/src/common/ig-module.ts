import type { CanonicalAllergy, CanonicalAllergyCandidate } from "../canonical/allergy.js";
import type { CanonicalCondition, CanonicalConditionCandidate } from "../canonical/condition.js";
import type { CanonicalDiagnosticReport, CanonicalLabObservation } from "../canonical/diagnostics.js";
import type { CanonicalDocumentReference } from "../canonical/document.js";
import type { CanonicalMedication, CanonicalMedicationRequest, CanonicalMedicationStatement } from "../canonical/medication.js";
import type { CanonicalOrganization } from "../canonical/organization.js";
import type { CanonicalPatient } from "../canonical/patient.js";
import type { CanonicalPractitioner } from "../canonical/practitioner.js";
import type { CanonicalProvenance } from "../canonical/provenance.js";
import type { CanonicalDiagnosticReportRecord, CanonicalPatientSummary, CanonicalPrescriptionRecord } from "../canonical/records.js";
import type { CanonicalVitalObservation } from "../canonical/vital.js";
import type { SerializeContext } from "./context.js";
import type { FhirValidationFailure, SerializedResource } from "./failure.js";
import type {
  AllergyIntoleranceResource,
  BundleResource,
  ConditionResource,
  DiagnosticReportResource,
  DocumentReferenceResource,
  MedicationRequestResource,
  MedicationResource,
  MedicationStatementResource,
  ObservationResource,
  OrganizationResource,
  PatientResource,
  PractitionerResource,
  ProvenanceResource,
  Reference,
} from "./r4.js";

/** Resource types this package knows how to profile-check. */
export type ProfiledResourceType =
  | "AllergyIntolerance"
  | "Provenance"
  | "Patient"
  | "Practitioner"
  | "Organization"
  | "Medication"
  | "MedicationRequest"
  | "MedicationStatement"
  | "DiagnosticReport"
  | "Observation"
  | "Condition"
  | "DocumentReference"
  | "Composition";

/** A document bundle (`Bundle.type = document`) plus the mapping warnings gathered while building it. */
export interface SerializedDocument {
  bundle: BundleResource;
  warnings: FhirValidationFailure[];
}

/**
 * The API every `src/ig/<version>/` folder exposes. `version-mapper.ts` selects one;
 * callers outside this package never import a folder directly (docs_v2/08 section 2).
 */
export interface IgModule {
  readonly version: string;
  readonly fhirVersion: "4.0.1";
  readonly label: string;
  /** Primary profile canonical URL per resource type produced by this folder. */
  readonly profiles: Readonly<Record<ProfiledResourceType, string>>;
  /**
   * Other profiles a resource type may legitimately declare in this folder (a DiagnosticReport is
   * either the lab or the imaging profile; an Observation may be a v7 vital-sign profile). The
   * validator accepts a resource declaring any of `profiles[type]` ∪ `alternateProfiles[type]`.
   */
  readonly alternateProfiles: Readonly<Partial<Record<ProfiledResourceType, readonly string[]>>>;
  /** Present only in folders whose IG defines the Indian Patient Summary (v7.x, docs_v2/08 section 8). */
  readonly supportsPatientSummary: boolean;

  serializeAllergyIntolerance(canonical: CanonicalAllergy, ctx?: SerializeContext): AllergyIntoleranceResource;
  parseAllergyIntolerance(resource: AllergyIntoleranceResource): CanonicalAllergyCandidate;
  serializeProvenance(canonical: CanonicalProvenance, targetRef: Reference, ctx?: SerializeContext): ProvenanceResource;

  serializePatient(canonical: CanonicalPatient, ctx?: SerializeContext): PatientResource;
  serializePractitioner(canonical: CanonicalPractitioner, ctx?: SerializeContext): PractitionerResource;
  serializeOrganization(canonical: CanonicalOrganization, ctx?: SerializeContext): OrganizationResource;
  serializeMedication(canonical: CanonicalMedication, ctx?: SerializeContext): MedicationResource;
  serializeMedicationRequest(canonical: CanonicalMedicationRequest, ctx?: SerializeContext): MedicationRequestResource;
  serializeMedicationStatement(canonical: CanonicalMedicationStatement, ctx?: SerializeContext): MedicationStatementResource;
  serializeDiagnosticReport(canonical: CanonicalDiagnosticReport, ctx?: SerializeContext): SerializedResource<DiagnosticReportResource>;
  serializeObservationLab(canonical: CanonicalLabObservation, ctx?: SerializeContext): SerializedResource<ObservationResource>;
  serializeObservationVital(canonical: CanonicalVitalObservation, ctx?: SerializeContext): SerializedResource<ObservationResource>;
  serializeCondition(canonical: CanonicalCondition, ctx?: SerializeContext): SerializedResource<ConditionResource>;
  parseCondition(resource: ConditionResource): CanonicalConditionCandidate;
  serializeDocumentReference(canonical: CanonicalDocumentReference, ctx?: SerializeContext): SerializedResource<DocumentReferenceResource>;

  serializePrescriptionRecord(record: CanonicalPrescriptionRecord, ctx?: SerializeContext): SerializedDocument;
  serializeDiagnosticReportRecord(record: CanonicalDiagnosticReportRecord, ctx?: SerializeContext): SerializedDocument;
  /** v7.x only; folders without the IPS leave this undefined and `supportsPatientSummary` false. */
  serializePatientSummary?(summary: CanonicalPatientSummary, ctx?: SerializeContext): SerializedDocument;
}

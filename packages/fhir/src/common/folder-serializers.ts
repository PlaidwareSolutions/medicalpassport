import type { CanonicalAllergy } from "../canonical/allergy.js";
import type { CanonicalCondition } from "../canonical/condition.js";
import type { CanonicalDiagnosticReport, CanonicalLabObservation } from "../canonical/diagnostics.js";
import type { CanonicalDocumentReference } from "../canonical/document.js";
import type { CanonicalMedication, CanonicalMedicationRequest, CanonicalMedicationStatement } from "../canonical/medication.js";
import type { CanonicalOrganization } from "../canonical/organization.js";
import type { CanonicalPatient } from "../canonical/patient.js";
import type { CanonicalPractitioner } from "../canonical/practitioner.js";
import type { CanonicalProvenance } from "../canonical/provenance.js";
import type { CanonicalDiagnosticReportRecord, CanonicalPrescriptionRecord } from "../canonical/records.js";
import type { CanonicalVitalObservation, ObservationConcept } from "../canonical/vital.js";
import { allergyToResource, resourceToAllergy } from "./allergy-codec.js";
import { diagnosticReportRecordDocument, prescriptionRecordDocument } from "./composition-codec.js";
import { conditionToResource, resourceToCondition } from "./condition-codec.js";
import type { SerializeContext } from "./context.js";
import { diagnosticReportToResource } from "./diagnostic-report-codec.js";
import { documentToResource } from "./document-codec.js";
import type { IgModule, ProfiledResourceType } from "./ig-module.js";
import { medicationRequestToResource, medicationStatementToResource, medicationToResource } from "./medication-codec.js";
import { labObservationToResource, vitalObservationToResource } from "./observation-codec.js";
import { organizationToResource } from "./organization-codec.js";
import { patientToResource } from "./patient-codec.js";
import { practitionerToResource } from "./practitioner-codec.js";
import { provenanceToResource } from "./provenance-codec.js";
import type { Reference } from "./r4.js";

export interface FolderPins {
  igVersion: string;
  profiles: Readonly<Record<ProfiledResourceType, string>>;
  /** Profile URLs that are not the primary for their type but this folder still emits. */
  extra: {
    diagnosticReportImaging: string;
    diagnosticReportRecord: string;
  };
  /** Which Observation profile a concept gets in this folder (v7 adds concept-specific profiles). */
  vitalProfileFor: (concept: ObservationConcept) => string;
}

/**
 * Every serializer a folder exposes, built from that folder's pins. Folders may share this code
 * (through `common/`) but never import each other (ADR-V2-003); the pins are what differ.
 */
export function buildFolderSerializers(pins: FolderPins): Omit<IgModule, "version" | "fhirVersion" | "label" | "profiles" | "alternateProfiles" | "supportsPatientSummary" | "serializePatientSummary"> {
  const { igVersion, profiles } = pins;
  const ctxFor = (profileUrl: string) => ({ igVersion, profileUrl });

  const serializeProvenance = (canonical: CanonicalProvenance, targetRef: Reference, ctx: SerializeContext = {}) =>
    provenanceToResource(canonical, targetRef, { ...ctx, igVersion, profileUrl: profiles.Provenance });

  const serializers = {
    serializeAllergyIntolerance: (c: CanonicalAllergy, _ctx: SerializeContext = {}) => allergyToResource(c, profiles.AllergyIntolerance),
    parseAllergyIntolerance: resourceToAllergy,
    serializeProvenance,
    serializePatient: (c: CanonicalPatient, _ctx: SerializeContext = {}) => patientToResource(c, profiles.Patient),
    serializePractitioner: (c: CanonicalPractitioner, _ctx: SerializeContext = {}) => practitionerToResource(c, profiles.Practitioner),
    serializeOrganization: (c: CanonicalOrganization, _ctx: SerializeContext = {}) => organizationToResource(c, profiles.Organization),
    serializeMedication: (c: CanonicalMedication, _ctx: SerializeContext = {}) => medicationToResource(c, profiles.Medication),
    serializeMedicationRequest: (c: CanonicalMedicationRequest, _ctx: SerializeContext = {}) => medicationRequestToResource(c, profiles.MedicationRequest),
    serializeMedicationStatement: (c: CanonicalMedicationStatement, _ctx: SerializeContext = {}) => medicationStatementToResource(c, profiles.MedicationStatement),
    serializeDiagnosticReport: (c: CanonicalDiagnosticReport, _ctx: SerializeContext = {}) =>
      diagnosticReportToResource(c, ctxFor(c.kind === "imaging" ? pins.extra.diagnosticReportImaging : profiles.DiagnosticReport)),
    serializeObservationLab: (c: CanonicalLabObservation, _ctx: SerializeContext = {}) => labObservationToResource(c, ctxFor(profiles.Observation)),
    serializeObservationVital: (c: CanonicalVitalObservation, _ctx: SerializeContext = {}) => vitalObservationToResource(c, { igVersion }, pins.vitalProfileFor),
    serializeCondition: (c: CanonicalCondition, _ctx: SerializeContext = {}) => conditionToResource(c, ctxFor(profiles.Condition)),
    parseCondition: resourceToCondition,
    serializeDocumentReference: (c: CanonicalDocumentReference, _ctx: SerializeContext = {}) => documentToResource(c, ctxFor(profiles.DocumentReference)),
  };

  return {
    ...serializers,
    serializePrescriptionRecord: (record: CanonicalPrescriptionRecord, ctx: SerializeContext = {}) =>
      prescriptionRecordDocument(record, serializers, { ...ctx, compositionProfileUrl: profiles.Composition }),
    serializeDiagnosticReportRecord: (record: CanonicalDiagnosticReportRecord, ctx: SerializeContext = {}) =>
      diagnosticReportRecordDocument(record, serializers, { ...ctx, compositionProfileUrl: pins.extra.diagnosticReportRecord }),
  };
}

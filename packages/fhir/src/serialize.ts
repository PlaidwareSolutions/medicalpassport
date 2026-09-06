import type { CanonicalAllergy } from "./canonical/allergy.js";
import type { CanonicalCondition } from "./canonical/condition.js";
import type { CanonicalDiagnosticReport, CanonicalLabObservation } from "./canonical/diagnostics.js";
import type { CanonicalDocumentReference } from "./canonical/document.js";
import type { CanonicalMedication, CanonicalMedicationRequest, CanonicalMedicationStatement } from "./canonical/medication.js";
import type { CanonicalOrganization } from "./canonical/organization.js";
import type { CanonicalPatient } from "./canonical/patient.js";
import type { CanonicalPractitioner } from "./canonical/practitioner.js";
import type { CanonicalDiagnosticReportRecord, CanonicalPatientSummary, CanonicalPrescriptionRecord } from "./canonical/records.js";
import type { CanonicalVitalObservation } from "./canonical/vital.js";
import type { SerializeContext } from "./common/context.js";
import type { FhirValidationFailure } from "./common/failure.js";
import type { SerializedDocument } from "./common/ig-module.js";
import { requireProvenanceOf } from "./common/provenance-guard.js";
import type { ClinicalResource, ProvenanceResource } from "./common/r4.js";
import { ArtifactNotSupportedError } from "./errors.js";
import { getIg, type IgVersion } from "./version-mapper.js";

export interface SerializeOptions extends SerializeContext {
  ig: IgVersion;
}

/** Canonical entities the boundary can export (docs_v2/08 section 6 priority order). */
export type SerializableEntity =
  | { kind: "AllergyIntolerance"; canonical: CanonicalAllergy }
  | { kind: "Patient"; canonical: CanonicalPatient }
  | { kind: "Practitioner"; canonical: CanonicalPractitioner }
  | { kind: "Organization"; canonical: CanonicalOrganization }
  | { kind: "Medication"; canonical: CanonicalMedication }
  | { kind: "MedicationRequest"; canonical: CanonicalMedicationRequest }
  | { kind: "MedicationStatement"; canonical: CanonicalMedicationStatement }
  | { kind: "DiagnosticReport"; canonical: CanonicalDiagnosticReport }
  | { kind: "ObservationLab"; canonical: CanonicalLabObservation }
  | { kind: "ObservationVital"; canonical: CanonicalVitalObservation }
  | { kind: "Condition"; canonical: CanonicalCondition }
  | { kind: "DocumentReference"; canonical: CanonicalDocumentReference };

export type SerializableKind = SerializableEntity["kind"];

export interface SerializedEntity<R extends ClinicalResource = ClinicalResource> {
  resource: R;
  /** Always emitted alongside the resource (docs_v2/08 section 6 #16). */
  provenance: ProvenanceResource;
  /** Mapping warnings (unmapped codes, free-text units) — the API records them as `FhirValidationFailure` rows. */
  warnings: FhirValidationFailure[];
}

/** The canonical entity name reported by `ProvenanceMissingError` per kind. */
const ENTITY_NAMES: Record<SerializableKind, string> = {
  AllergyIntolerance: "PatientAllergy",
  Patient: "PatientProfile",
  Practitioner: "Practitioner",
  Organization: "Organization",
  Medication: "MedicationProduct",
  MedicationRequest: "PrescriptionItem",
  MedicationStatement: "PatientMedication",
  DiagnosticReport: "DiagnosticReport",
  ObservationLab: "DiagnosticResult",
  ObservationVital: "Observation",
  Condition: "PatientCondition",
  DocumentReference: "PatientDocument",
};

/**
 * The entry point the API uses: `serialize(entity, { ig })`. Produces the clinical resource plus its
 * `Provenance`. Throws `ProvenanceMissingError` when the canonical row lacks its provenance block
 * (fails closed, ADR-V2-002) and `UnsupportedIgVersionError` for an unknown IG.
 */
export function serialize(entity: SerializableEntity, options: SerializeOptions): SerializedEntity {
  const { ig: version, ...ctx } = options;
  const ig = getIg(version);
  // Checked here as well as in every codec so the error names the canonical entity, not a resource type.
  const { provenance: block } = requireProvenanceOf(ENTITY_NAMES[entity.kind], entity.canonical);

  const built = build(entity, ig, ctx);
  const provenance = ig.serializeProvenance(block, { reference: `${built.resource.resourceType}/${built.resource.id}` }, ctx);
  return { resource: built.resource, provenance, warnings: built.warnings };
}

function build(entity: SerializableEntity, ig: ReturnType<typeof getIg>, ctx: SerializeContext): { resource: ClinicalResource; warnings: FhirValidationFailure[] } {
  switch (entity.kind) {
    case "AllergyIntolerance":
      return { resource: ig.serializeAllergyIntolerance(entity.canonical, ctx), warnings: [] };
    case "Patient":
      return { resource: ig.serializePatient(entity.canonical, ctx), warnings: [] };
    case "Practitioner":
      return { resource: ig.serializePractitioner(entity.canonical, ctx), warnings: [] };
    case "Organization":
      return { resource: ig.serializeOrganization(entity.canonical, ctx), warnings: [] };
    case "Medication":
      return { resource: ig.serializeMedication(entity.canonical, ctx), warnings: [] };
    case "MedicationRequest":
      return { resource: ig.serializeMedicationRequest(entity.canonical, ctx), warnings: [] };
    case "MedicationStatement":
      return { resource: ig.serializeMedicationStatement(entity.canonical, ctx), warnings: [] };
    case "DiagnosticReport":
      return ig.serializeDiagnosticReport(entity.canonical, ctx);
    case "ObservationLab":
      return ig.serializeObservationLab(entity.canonical, ctx);
    case "ObservationVital":
      return ig.serializeObservationVital(entity.canonical, ctx);
    case "Condition":
      return ig.serializeCondition(entity.canonical, ctx);
    case "DocumentReference":
      return ig.serializeDocumentReference(entity.canonical, ctx);
  }
}

/** docs_v2/08 section 6 #1: one prescription as a `PrescriptionRecord` document bundle. */
export function serializePrescriptionRecord(record: CanonicalPrescriptionRecord, options: SerializeOptions): SerializedDocument {
  const { ig: version, ...ctx } = options;
  return getIg(version).serializePrescriptionRecord(record, ctx);
}

/** docs_v2/08 section 6 #5 / #7: one report as a `DiagnosticReportRecord` document bundle. */
export function serializeDiagnosticReportRecord(record: CanonicalDiagnosticReportRecord, options: SerializeOptions): SerializedDocument {
  const { ig: version, ...ctx } = options;
  return getIg(version).serializeDiagnosticReportRecord(record, ctx);
}

/** docs_v2/08 section 8: the Indian Patient Summary; throws `ArtifactNotSupportedError` on a folder without it. */
export function serializePatientSummary(summary: CanonicalPatientSummary, options: SerializeOptions): SerializedDocument {
  const { ig: version, ...ctx } = options;
  const ig = getIg(version);
  if (!ig.supportsPatientSummary || !ig.serializePatientSummary) {
    throw new ArtifactNotSupportedError("IndianPatientSummary", version);
  }
  return ig.serializePatientSummary(summary, ctx);
}

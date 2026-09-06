import type { CanonicalDiagnosticReport, DiagnosticReportKind, DiagnosticReportStatus, ImagingModality } from "../canonical/diagnostics.js";
import type { CodecContext, SerializedResource } from "./failure.js";
import { requireProvenanceOf } from "./provenance-guard.js";
import { CODE_SYSTEMS, MEDPASS_SYSTEMS, type CodeableConcept, type DiagnosticReportResource, type Reference } from "./r4.js";
import { patientReference, reference } from "./references.js";

/** HL7 v2-0074 diagnostic service section per kind. */
const KIND_CATEGORY: Record<DiagnosticReportKind, { code: string; display: string }> = {
  laboratory: { code: "LAB", display: "Laboratory" },
  imaging: { code: "RAD", display: "Radiology" },
  ecg: { code: "EC", display: "Electrocardiac (e.g. EKG, EEC, Holter)" },
  echo: { code: "CUS", display: "Cardiac Ultrasound" },
  pathology: { code: "PAT", display: "Pathology (gross & histopath, not surgical)" },
  microbiology: { code: "MB", display: "Microbiology" },
  genetics: { code: "GE", display: "Genetics" },
  other: { code: "OTH", display: "Other" },
};

/** DICOM modality codes (DCM CodeSystem) for the imaging kinds we store. */
const MODALITY_DCM: Record<ImagingModality, { code: string; display: string } | null> = {
  xray: { code: "DX", display: "Digital Radiography" },
  ct: { code: "CT", display: "Computed Tomography" },
  mri: { code: "MR", display: "Magnetic Resonance" },
  ultrasound: { code: "US", display: "Ultrasound" },
  mammography: { code: "MG", display: "Mammography" },
  pet: { code: "PT", display: "Positron emission tomography" },
  nuclear: { code: "NM", display: "Nuclear Medicine" },
  other: null,
};

const STATUS_TO_FHIR: Record<DiagnosticReportStatus, DiagnosticReportResource["status"]> = {
  registered: "registered",
  partial: "partial",
  final: "final",
  amended: "amended",
  cancelled: "cancelled",
};

/**
 * `DiagnosticReport` row → R4 `DiagnosticReport` (lab or imaging profile chosen by the folder).
 * `result` references the current `Observation`s; the original report pages ride along as
 * `DocumentReference`s in the record bundle, never as `presentedForm` bytes.
 */
export function diagnosticReportToResource(input: CanonicalDiagnosticReport, ctx: CodecContext): SerializedResource<DiagnosticReportResource> {
  const c = requireProvenanceOf("DiagnosticReport", input);
  const category = KIND_CATEGORY[c.kind];
  const code: CodeableConcept = { text: c.title, coding: [{ system: MEDPASS_SYSTEMS.csDiagnosticReportKind, code: c.kind, display: category.display }] };
  const modality = c.modality ? MODALITY_DCM[c.modality] : null;
  if (modality) code.coding!.push({ system: CODE_SYSTEMS.dicomModality, code: modality.code, display: modality.display });

  const resource: DiagnosticReportResource = {
    resourceType: "DiagnosticReport",
    id: c.id,
    meta: { profile: [ctx.profileUrl] },
    identifier: [{ system: MEDPASS_SYSTEMS.diagnosticReport, value: c.id }],
    status: STATUS_TO_FHIR[c.status],
    category: [{ coding: [{ system: CODE_SYSTEMS.diagnosticServiceSection, code: category.code, display: category.display }], ...(c.category ? { text: c.category } : {}) }],
    code,
    subject: patientReference(c.patient),
  };
  const effective = c.specimenCollectedAt ?? c.testedAt;
  if (effective) resource.effectiveDateTime = effective;
  if (c.reportedAt) resource.issued = c.reportedAt;
  if (c.encounterId) resource.encounter = reference("Encounter", c.encounterId);

  const performer: Reference[] = [];
  if (c.organizationId) performer.push(reference("Organization", c.organizationId));
  else if (c.facilityNameText) performer.push({ display: c.facilityNameText });
  if (c.reportingPractitionerId) performer.push(reference("Practitioner", c.reportingPractitionerId));
  if (performer.length > 0) resource.performer = performer;
  if (c.orderingPractitionerId) resource.basedOn = [{ identifier: { system: MEDPASS_SYSTEMS.practitioner, value: c.orderingPractitionerId }, display: "Ordering practitioner" }];

  if (c.resultIds.length > 0) resource.result = c.resultIds.map((id) => reference("Observation", id));
  const conclusion = [c.impressionText, c.conclusionText, c.findingsText ? `Findings: ${c.findingsText}` : null].filter(Boolean).join("\n");
  if (conclusion) resource.conclusion = conclusion;
  if (c.bodySite) resource.extension = [{ url: MEDPASS_SYSTEMS.extBodySite, valueString: c.bodySite }];
  return { resource, warnings: [] };
}

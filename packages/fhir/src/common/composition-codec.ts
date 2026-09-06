import type { CanonicalProvenance } from "../canonical/provenance.js";
import type { CanonicalDiagnosticReportRecord, CanonicalPrescriptionRecord } from "../canonical/records.js";
import type { SerializeContext } from "./context.js";
import type { FhirValidationFailure } from "./failure.js";
import type { IgModule, SerializedDocument } from "./ig-module.js";
import { requireProvenanceOf } from "./provenance-guard.js";
import {
  CODE_SYSTEMS,
  MEDPASS_SYSTEMS,
  type BundleEntry,
  type BundleResource,
  type CompositionResource,
  type CompositionSection,
  type ProvenanceResource,
  type Reference,
  type ResourceBase,
} from "./r4.js";
import { reference } from "./references.js";

/** The per-folder serializers a document builder needs (everything but the document builders themselves). */
export type RecordSerializers = Pick<
  IgModule,
  | "serializeProvenance"
  | "serializePatient"
  | "serializePractitioner"
  | "serializeOrganization"
  | "serializeMedication"
  | "serializeMedicationRequest"
  | "serializeDiagnosticReport"
  | "serializeObservationLab"
  | "serializeDocumentReference"
>;

export interface DocumentBuildOptions extends SerializeContext {
  /** Profile canonical for the Composition of this document type. */
  compositionProfileUrl: string;
}

/**
 * Accumulates the entries of one document bundle in a stable order and stamps every clinical
 * resource with its Provenance (docs_v2/08 section 6 #16), so nothing enters a bundle unprovenanced.
 */
export class DocumentAssembler {
  private readonly entries: BundleEntry[] = [];
  readonly warnings: FhirValidationFailure[] = [];
  private readonly seen = new Set<string>();

  constructor(
    private readonly ig: RecordSerializers,
    private readonly ctx: SerializeContext,
  ) {}

  /** Adds a resource plus the Provenance built from `block`; duplicates (same type/id) are skipped. */
  add<R extends ResourceBase>(resource: R, block: CanonicalProvenance): R {
    const key = `${resource.resourceType}/${resource.id}`;
    if (this.seen.has(key)) return resource;
    this.seen.add(key);
    this.entries.push({ fullUrl: key, resource });
    const provenance = this.ig.serializeProvenance(block, { reference: key }, this.ctx);
    this.entries.push({ fullUrl: `Provenance/${provenance.id}`, resource: provenance });
    return resource;
  }

  warn(warnings: FhirValidationFailure[]): void {
    this.warnings.push(...warnings);
  }

  /** A Provenance for a resource the caller places itself (the Composition, which must be entry[0]). */
  provenanceFor(block: CanonicalProvenance, target: string): ProvenanceResource {
    return this.ig.serializeProvenance(block, { reference: target }, this.ctx);
  }

  toBundle(id: string, timestamp: string): BundleResource {
    return {
      resourceType: "Bundle",
      id,
      meta: { lastUpdated: timestamp },
      identifier: { system: "urn:medicinepassport:bundle", value: id },
      type: "document",
      timestamp,
      entry: this.entries,
    };
  }
}

/** Author precedence for a Composition: the practitioner, else the organization, else the patient (R4 allows all three). */
function authorRef(practitionerId: string | null, organizationId: string | null, patientId: string): Reference[] {
  if (practitionerId) return [reference("Practitioner", practitionerId)];
  if (organizationId) return [reference("Organization", organizationId)];
  return [reference("Patient", patientId)];
}

/**
 * docs_v2/08 section 6 #1: `Prescription` + items + practitioner/organization + original document →
 * `PrescriptionRecord` document bundle. Type/section codes follow the NRCeS PrescriptionRecord
 * convention (SNOMED 440545006 "Prescription record").
 */
export function prescriptionRecordDocument(record: CanonicalPrescriptionRecord, ig: RecordSerializers, opts: DocumentBuildOptions): SerializedDocument {
  const prescription = requireProvenanceOf("Prescription", record.prescription);
  const { compositionProfileUrl, ...ctx } = opts;
  const timestamp = opts.timestamp ?? prescription.provenance.recordedAt;
  const bundleId = opts.bundleId ?? prescription.id;
  const assembler = new DocumentAssembler(ig, ctx);

  const patient = assembler.add(ig.serializePatient(record.patient, ctx), requireProvenanceOf("PatientProfile", record.patient).provenance);
  const practitioner = record.practitioner ? assembler.add(ig.serializePractitioner(record.practitioner, ctx), requireProvenanceOf("Practitioner", record.practitioner).provenance) : null;
  const organization = record.organization ? assembler.add(ig.serializeOrganization(record.organization, ctx), requireProvenanceOf("Organization", record.organization).provenance) : null;

  const entryRefs: Reference[] = [];
  for (const medication of record.medications) {
    assembler.add(ig.serializeMedication(medication, ctx), requireProvenanceOf("MedicationProduct", medication).provenance);
  }
  for (const item of record.items) {
    const resource = assembler.add(ig.serializeMedicationRequest(item, ctx), requireProvenanceOf("PrescriptionItem", item).provenance);
    entryRefs.push({ reference: `MedicationRequest/${resource.id}` });
  }
  for (const document of record.documents) {
    const { resource, warnings } = ig.serializeDocumentReference(document, ctx);
    assembler.add(resource, requireProvenanceOf("PatientDocument", document).provenance);
    assembler.warn(warnings);
    entryRefs.push({ reference: `DocumentReference/${resource.id}` });
  }

  const section: CompositionSection = {
    title: "Prescription record",
    code: { coding: [{ system: CODE_SYSTEMS.snomed, code: "440545006", display: "Prescription record" }] },
    ...(entryRefs.length > 0 ? { entry: entryRefs } : { emptyReason: emptyReason() }),
  };
  const composition: CompositionResource = {
    resourceType: "Composition",
    id: prescription.id,
    meta: { profile: [compositionProfileUrl] },
    identifier: { system: MEDPASS_SYSTEMS.prescription, value: prescription.id },
    status: "final",
    type: { coding: [{ system: CODE_SYSTEMS.snomed, code: "440545006", display: "Prescription record" }], text: "Prescription record" },
    subject: reference("Patient", patient.id!),
    date: timestamp,
    author: authorRef(practitioner?.id ?? null, organization?.id ?? null, patient.id!),
    title: prescription.prescribedAt ? `Prescription ${prescription.prescribedAt}` : "Prescription",
    section: [section],
  };
  if (prescription.encounterId) composition.encounter = reference("Encounter", prescription.encounterId);
  if (organization) composition.custodian = reference("Organization", organization.id!);
  if (prescription.diagnosisText) {
    composition.section!.push({ title: "Diagnosis", code: { coding: [{ system: CODE_SYSTEMS.loinc, code: "29548-5", display: "Diagnosis" }] }, text: narrative(prescription.diagnosisText) });
  }

  return finish(assembler, composition, prescription.provenance, bundleId, timestamp);
}

/**
 * docs_v2/08 section 6 #5 / #7: `DiagnosticReport` + results + performer + original pages →
 * `DiagnosticReportRecord` document bundle (SNOMED 721981007 "Diagnostic studies report").
 */
export function diagnosticReportRecordDocument(record: CanonicalDiagnosticReportRecord, ig: RecordSerializers, opts: DocumentBuildOptions): SerializedDocument {
  const report = requireProvenanceOf("DiagnosticReport", record.report);
  const { compositionProfileUrl, ...ctx } = opts;
  const timestamp = opts.timestamp ?? report.provenance.recordedAt;
  const bundleId = opts.bundleId ?? report.id;
  const assembler = new DocumentAssembler(ig, ctx);

  const patient = assembler.add(ig.serializePatient(record.patient, ctx), requireProvenanceOf("PatientProfile", record.patient).provenance);
  const practitioner = record.practitioner ? assembler.add(ig.serializePractitioner(record.practitioner, ctx), requireProvenanceOf("Practitioner", record.practitioner).provenance) : null;
  const organization = record.organization ? assembler.add(ig.serializeOrganization(record.organization, ctx), requireProvenanceOf("Organization", record.organization).provenance) : null;

  for (const result of record.results) {
    const { resource, warnings } = ig.serializeObservationLab(result, ctx);
    assembler.add(resource, requireProvenanceOf("DiagnosticResult", result).provenance);
    assembler.warn(warnings);
  }
  const reportOut = ig.serializeDiagnosticReport(record.report, ctx);
  assembler.add(reportOut.resource, report.provenance);
  assembler.warn(reportOut.warnings);
  const entryRefs: Reference[] = [{ reference: `DiagnosticReport/${reportOut.resource.id}` }];
  for (const document of record.documents) {
    const { resource, warnings } = ig.serializeDocumentReference(document, ctx);
    assembler.add(resource, requireProvenanceOf("PatientDocument", document).provenance);
    assembler.warn(warnings);
    entryRefs.push({ reference: `DocumentReference/${resource.id}` });
  }

  const composition: CompositionResource = {
    resourceType: "Composition",
    id: report.id,
    meta: { profile: [compositionProfileUrl] },
    identifier: { system: MEDPASS_SYSTEMS.diagnosticReport, value: report.id },
    status: "final",
    type: { coding: [{ system: CODE_SYSTEMS.snomed, code: "721981007", display: "Diagnostic studies report" }], text: "Diagnostic Report" },
    subject: reference("Patient", patient.id!),
    date: timestamp,
    author: authorRef(practitioner?.id ?? null, organization?.id ?? null, patient.id!),
    title: report.title,
    section: [
      {
        title: "Diagnostic report",
        code: { coding: [{ system: CODE_SYSTEMS.snomed, code: "721981007", display: "Diagnostic studies report" }] },
        entry: entryRefs,
      },
    ],
  };
  if (report.encounterId) composition.encounter = reference("Encounter", report.encounterId);
  if (organization) composition.custodian = reference("Organization", organization.id!);

  return finish(assembler, composition, report.provenance, bundleId, timestamp);
}

/** Composition first (bdl-11), then its Provenance, then every entry the assembler collected. */
function finish(assembler: DocumentAssembler, composition: CompositionResource, block: CanonicalProvenance, bundleId: string, timestamp: string): SerializedDocument {
  const bundle = assembler.toBundle(bundleId, timestamp);
  const provenance = assembler.provenanceFor(block, `Composition/${composition.id}`);
  bundle.entry = [
    { fullUrl: `Composition/${composition.id}`, resource: composition },
    { fullUrl: `Provenance/${provenance.id}`, resource: provenance },
    ...(bundle.entry ?? []),
  ];
  return { bundle, warnings: assembler.warnings };
}

export function emptyReason(): CompositionSection["emptyReason"] {
  return { coding: [{ system: CODE_SYSTEMS.listEmptyReason, code: "unavailable", display: "Unavailable" }] };
}

/** Minimal XHTML narrative; the text is escaped so a free-text field can never inject markup. */
export function narrative(text: string): { status: "generated"; div: string } {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return { status: "generated", div: `<div xmlns="http://www.w3.org/1999/xhtml">${escaped}</div>` };
}

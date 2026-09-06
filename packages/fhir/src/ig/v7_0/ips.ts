/**
 * Indian Patient Summary (docs_v2/08 section 8; ADR-V2-003 "v7.x-only capability").
 *
 * Composed from canonical rows; sections are limited to rows the patient has confirmed
 * (`verification` >= patient_confirmed); every entry carries a Provenance. Export requires step-up
 * and is audited by the API — this module only builds the document.
 */
import type { CanonicalProvenance, VerificationState } from "../../canonical/provenance.js";
import type { CanonicalPatientSummary } from "../../canonical/records.js";
import { DocumentAssembler, emptyReason } from "../../common/composition-codec.js";
import type { SerializeContext } from "../../common/context.js";
import type { FhirValidationFailure } from "../../common/failure.js";
import type { buildFolderSerializers } from "../../common/folder-serializers.js";
import type { IgModule, SerializedDocument } from "../../common/ig-module.js";
import { requireProvenanceOf } from "../../common/provenance-guard.js";
import { CODE_SYSTEMS, type CompositionResource, type CompositionSection, type Reference } from "../../common/r4.js";
import { reference } from "../../common/references.js";
import { EXTRA_PROFILES, IG_VERSION } from "./profiles.js";

type FolderSerializers = ReturnType<typeof buildFolderSerializers>;

/** States that count as "confirmed by the patient or better" for inclusion in the summary. */
const CONFIRMED: ReadonlySet<VerificationState> = new Set(["patient_confirmed", "provider_verified", "source_authenticated"]);

/** IPS section codes (LOINC), in the order the composition lists them. */
const SECTIONS = {
  medications: { code: "10160-0", display: "History of Medication use Narrative", title: "Medication Summary", required: true },
  allergies: { code: "48765-2", display: "Allergies and adverse reactions Document", title: "Allergies and Intolerances", required: true },
  problems: { code: "11450-4", display: "Problem list - Reported", title: "Problem List", required: true },
  results: { code: "30954-2", display: "Relevant diagnostic tests/laboratory data Narrative", title: "Results", required: false },
  vitals: { code: "8716-3", display: "Vital signs", title: "Vital Signs", required: false },
} as const;

function isConfirmed(row: { id: string; provenance: CanonicalProvenance | null }): boolean {
  return !!row.provenance && CONFIRMED.has(row.provenance.verification);
}

function excluded(resourceType: string, id: string): FhirValidationFailure {
  return {
    path: `${resourceType}.meta`,
    severity: "information",
    message: `${resourceType}/${id} omitted from the patient summary: not patient-confirmed`,
    profileUrl: EXTRA_PROFILES.indianPatientSummary,
    resourceType,
    igVersion: IG_VERSION,
  };
}

function section(key: keyof typeof SECTIONS, entries: Reference[]): CompositionSection | null {
  const meta = SECTIONS[key];
  if (entries.length === 0 && !meta.required) return null;
  return {
    title: meta.title,
    code: { coding: [{ system: CODE_SYSTEMS.loinc, code: meta.code, display: meta.display }] },
    ...(entries.length > 0 ? { entry: entries } : { emptyReason: emptyReason() }),
  };
}

export function serializePatientSummary(summary: CanonicalPatientSummary, serializers: FolderSerializers, ctx: SerializeContext = {}): SerializedDocument {
  const patientRow = requireProvenanceOf("PatientProfile", summary.patient);
  const timestamp = ctx.timestamp ?? patientRow.provenance.recordedAt;
  const bundleId = ctx.bundleId ?? `ips-${patientRow.id}`;
  const assembler = new DocumentAssembler(serializers, ctx);
  const warnings: FhirValidationFailure[] = [];

  const patient = assembler.add(serializers.serializePatient(summary.patient, ctx), patientRow.provenance);
  const practitioner = summary.author.practitioner
    ? assembler.add(serializers.serializePractitioner(summary.author.practitioner, ctx), requireProvenanceOf("Practitioner", summary.author.practitioner).provenance)
    : null;
  const organization = summary.author.organization
    ? assembler.add(serializers.serializeOrganization(summary.author.organization, ctx), requireProvenanceOf("Organization", summary.author.organization).provenance)
    : null;

  // Medication summary: statements the patient confirmed, plus the catalog products they reference.
  const medicationRefs: Reference[] = [];
  const catalog = new Map(summary.catalog.map((m) => [m.id, m]));
  for (const statement of summary.medications) {
    if (!isConfirmed(statement)) {
      warnings.push(excluded("MedicationStatement", statement.id));
      continue;
    }
    if (statement.medicationId) {
      const product = catalog.get(statement.medicationId);
      if (product) assembler.add(serializers.serializeMedication({ ...product, provenance: product.provenance ?? statement.provenance }, ctx), statement.provenance!);
    }
    const resource = assembler.add(serializers.serializeMedicationStatement(statement, ctx), statement.provenance!);
    medicationRefs.push({ reference: `MedicationStatement/${resource.id}` });
  }

  const allergyRefs: Reference[] = [];
  for (const allergy of summary.allergies) {
    if (!isConfirmed(allergy)) {
      warnings.push(excluded("AllergyIntolerance", allergy.id));
      continue;
    }
    const resource = assembler.add(serializers.serializeAllergyIntolerance(allergy, ctx), allergy.provenance!);
    allergyRefs.push({ reference: `AllergyIntolerance/${resource.id}` });
  }

  const problemRefs: Reference[] = [];
  for (const condition of summary.conditions) {
    if (!isConfirmed(condition)) {
      warnings.push(excluded("Condition", condition.id));
      continue;
    }
    const { resource, warnings: w } = serializers.serializeCondition(condition, ctx);
    assembler.add(resource, condition.provenance!);
    assembler.warn(w);
    problemRefs.push({ reference: `Condition/${resource.id}` });
  }

  const resultRefs: Reference[] = [];
  for (const result of summary.results) {
    if (!isConfirmed(result)) {
      warnings.push(excluded("Observation", result.id));
      continue;
    }
    const { resource, warnings: w } = serializers.serializeObservationLab(result, ctx);
    assembler.add(resource, result.provenance!);
    assembler.warn(w);
    resultRefs.push({ reference: `Observation/${resource.id}` });
  }

  const vitalRefs: Reference[] = [];
  for (const vital of summary.vitals) {
    if (!isConfirmed(vital)) {
      warnings.push(excluded("Observation", vital.id));
      continue;
    }
    const { resource, warnings: w } = serializers.serializeObservationVital(vital, ctx);
    assembler.add(resource, vital.provenance!);
    assembler.warn(w);
    vitalRefs.push({ reference: `Observation/${resource.id}` });
  }

  const sections = [
    section("medications", medicationRefs),
    section("allergies", allergyRefs),
    section("problems", problemRefs),
    section("results", resultRefs),
    section("vitals", vitalRefs),
  ].filter((s): s is CompositionSection => s !== null);

  const composition: CompositionResource = {
    resourceType: "Composition",
    id: bundleId,
    meta: { profile: [EXTRA_PROFILES.indianPatientSummary] },
    identifier: { system: "urn:medicinepassport:patient-summary", value: bundleId },
    status: "final",
    type: { coding: [{ system: CODE_SYSTEMS.loinc, code: "60591-5", display: "Patient summary Document" }], text: "Indian Patient Summary" },
    subject: reference("Patient", patient.id!),
    date: timestamp,
    author: practitioner ? [reference("Practitioner", practitioner.id!)] : organization ? [reference("Organization", organization.id!)] : [reference("Patient", patient.id!)],
    title: "Indian Patient Summary",
    section: sections,
  };
  if (organization) composition.custodian = reference("Organization", organization.id!);

  const bundle = assembler.toBundle(bundleId, timestamp);
  const provenance = assembler.provenanceFor(patientRow.provenance, `Composition/${composition.id}`);
  bundle.entry = [{ fullUrl: `Composition/${composition.id}`, resource: composition }, { fullUrl: `Provenance/${provenance.id}`, resource: provenance }, ...(bundle.entry ?? [])];
  return { bundle, warnings: [...warnings, ...assembler.warnings] };
}

/** Narrow type so `index.ts` can attach the IPS to the frozen module without a cast. */
export type PatientSummarySerializer = NonNullable<IgModule["serializePatientSummary"]>;

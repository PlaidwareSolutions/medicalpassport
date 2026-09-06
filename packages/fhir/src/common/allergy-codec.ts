import {
  ALLERGY_CLINICAL_STATUSES,
  type AllergyCategory,
  type AllergyClinicalStatus,
  type AllergyCriticality,
  type AllergySeverity,
  type CanonicalAllergy,
  type CanonicalAllergyCandidate,
} from "../canonical/allergy.js";
import { AUTHENTICATED_VERIFICATION_STATES, type CanonicalProvenance } from "../canonical/provenance.js";
import { FhirParseError, ProvenanceMissingError } from "../errors.js";
import {
  CODE_SYSTEMS,
  type AllergyIntoleranceReaction,
  type AllergyIntoleranceResource,
  type CodeableConcept,
} from "./r4.js";
import { parsePatientReference, patientReference } from "./references.js";

type FhirCriticality = NonNullable<AllergyIntoleranceResource["criticality"]>;

const CRITICALITY_TO_FHIR: Record<AllergyCriticality, FhirCriticality> = {
  low: "low",
  high: "high",
  unable_to_assess: "unable-to-assess",
};
const CRITICALITY_FROM_FHIR: Record<FhirCriticality, AllergyCriticality> = {
  low: "low",
  high: "high",
  "unable-to-assess": "unable_to_assess",
};

type FhirCategory = NonNullable<AllergyIntoleranceResource["category"]>[number];
const FHIR_CATEGORIES: ReadonlySet<string> = new Set<FhirCategory>([
  "food",
  "medication",
  "environment",
  "biologic",
]);

/** Ensures the canonical row carries provenance; throws `ProvenanceMissingError` otherwise (ADR-V2-002). */
export function requireProvenance(
  canonical: CanonicalAllergy,
): CanonicalAllergy & { provenance: CanonicalProvenance } {
  const p = canonical.provenance;
  if (!p || typeof p !== "object" || !p.source || !p.verification) {
    throw new ProvenanceMissingError("PatientAllergy", canonical.id);
  }
  return { ...canonical, provenance: p };
}

/**
 * Canonical -> R4 AllergyIntolerance. Shared by every IG folder; the folder supplies its profile URL.
 * Verification status is derived from the provenance block: only `provider_verified` /
 * `source_authenticated` rows are exported as `confirmed` (patient-entered data is never
 * represented as provider-authenticated).
 */
export function allergyToResource(input: CanonicalAllergy, profileUrl: string): AllergyIntoleranceResource {
  const canonical = requireProvenance(input);
  const confirmed = AUTHENTICATED_VERIFICATION_STATES.has(canonical.provenance.verification);

  const resource: AllergyIntoleranceResource = {
    resourceType: "AllergyIntolerance",
    id: canonical.id,
    meta: { profile: [profileUrl] },
    clinicalStatus: {
      coding: [{ system: CODE_SYSTEMS.allergyClinical, code: canonical.clinicalStatus }],
    },
    verificationStatus: {
      coding: [
        { system: CODE_SYSTEMS.allergyVerification, code: confirmed ? "confirmed" : "unconfirmed" },
      ],
    },
    patient: patientReference(canonical.patient),
    code: codeConcept(canonical),
    recordedDate: canonical.provenance.recordedAt,
  };

  if (canonical.category !== "other") resource.category = [canonical.category];
  if (canonical.criticality) resource.criticality = CRITICALITY_TO_FHIR[canonical.criticality];
  if (canonical.onsetDate) resource.onsetDateTime = canonical.onsetDate;
  if (canonical.notes) resource.note = [{ text: canonical.notes }];

  const reaction = reactionElement(canonical);
  if (reaction) resource.reaction = [reaction];

  return resource;
}

function codeConcept(c: CanonicalAllergy): CodeableConcept {
  const concept: CodeableConcept = { text: c.substanceText };
  if (c.codeSystem && c.code) {
    concept.coding = [
      c.codeDisplay
        ? { system: c.codeSystem, code: c.code, display: c.codeDisplay }
        : { system: c.codeSystem, code: c.code },
    ];
  }
  return concept;
}

function reactionElement(c: CanonicalAllergy): AllergyIntoleranceReaction | null {
  if (!c.reactionText && !c.severity) return null;
  const reaction: AllergyIntoleranceReaction = {
    // R4 requires manifestation 1..*; when only severity is known we say so with data-absent-reason.
    manifestation: c.reactionText
      ? [{ text: c.reactionText }]
      : [{ extension: [{ url: CODE_SYSTEMS.dataAbsentReason, valueCode: "unknown" }] }],
  };
  if (c.reactionText) reaction.description = c.reactionText;
  if (c.severity) reaction.severity = c.severity;
  return reaction;
}

/**
 * R4 AllergyIntolerance -> canonical candidate. Provenance is deliberately not recovered from the
 * payload: the importing service stamps it (`abdm_imported` / `source_authenticated`, docs_v2/08 section 7).
 */
export function resourceToAllergy(resource: AllergyIntoleranceResource): CanonicalAllergyCandidate {
  const rt = "AllergyIntolerance";
  if (resource.resourceType !== rt) {
    throw new FhirParseError(rt, "resourceType", `expected ${rt}, got ${String(resource.resourceType)}`);
  }
  if (!resource.id) throw new FhirParseError(rt, "id", "id is required");

  const substanceText = resource.code?.text ?? resource.code?.coding?.[0]?.display;
  if (!substanceText) {
    throw new FhirParseError(rt, "code", "code.text or code.coding[0].display is required");
  }

  const coding = resource.code?.coding?.[0];
  const firstReaction = resource.reaction?.[0];
  const manifestationText = firstReaction?.manifestation?.[0]?.text ?? null;

  return {
    id: resource.id,
    patient: parsePatientReference(resource.patient, rt),
    substanceText,
    category: parseCategory(resource.category),
    clinicalStatus: parseClinicalStatus(resource.clinicalStatus),
    criticality: resource.criticality ? CRITICALITY_FROM_FHIR[resource.criticality] : null,
    severity: (firstReaction?.severity as AllergySeverity | undefined) ?? null,
    reactionText: firstReaction?.description ?? manifestationText,
    onsetDate: resource.onsetDateTime ?? null,
    codeSystem: coding?.system ?? null,
    code: coding?.code ?? null,
    codeDisplay: coding?.display ?? null,
    notes: resource.note?.[0]?.text ?? null,
  };
}

function parseCategory(category: AllergyIntoleranceResource["category"]): AllergyCategory {
  const first = category?.[0];
  return first && FHIR_CATEGORIES.has(first) ? first : "other";
}

function parseClinicalStatus(concept: CodeableConcept | undefined): AllergyClinicalStatus {
  const code = concept?.coding?.find((c) => !c.system || c.system === CODE_SYSTEMS.allergyClinical)?.code;
  return (ALLERGY_CLINICAL_STATUSES as readonly string[]).includes(code ?? "")
    ? (code as AllergyClinicalStatus)
    : "active";
}

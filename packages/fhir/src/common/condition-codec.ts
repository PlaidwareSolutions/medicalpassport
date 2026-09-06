import type { CanonicalCondition, CanonicalConditionCandidate, ConditionClinicalStatus } from "../canonical/condition.js";
import { AUTHENTICATED_VERIFICATION_STATES } from "../canonical/provenance.js";
import { FhirParseError } from "../errors.js";
import { type CodecContext, type SerializedResource, warning } from "./failure.js";
import { requireProvenanceOf } from "./provenance-guard.js";
import { CODE_SYSTEMS, MEDPASS_SYSTEMS, type CodeableConcept, type ConditionResource } from "./r4.js";
import { parsePatientReference, patientReference, reference } from "./references.js";

/** Canonical status → condition-clinical (R4 codes: active, recurrence, relapse, inactive, remission, resolved). */
const CLINICAL_TO_FHIR: Record<ConditionClinicalStatus, string | null> = {
  active: "active",
  remission: "remission",
  resolved: "resolved",
  inactive: "inactive",
  unknown: null,
};

/**
 * `PatientCondition` → R4 `Condition`. SNOMED CT is required at the ABDM boundary (docs_v2/08 §6
 * #13); a row without it is exported with the local CodeSystem + text and a warning, never dropped.
 */
export function conditionToResource(input: CanonicalCondition, ctx: CodecContext): SerializedResource<ConditionResource> {
  const c = requireProvenanceOf("PatientCondition", input);
  const warnings = [];
  const confirmed = AUTHENTICATED_VERIFICATION_STATES.has(c.provenance.verification);

  const code: CodeableConcept = { text: c.label };
  if (c.codeSystem && c.code) {
    code.coding = [c.codeDisplay ? { system: c.codeSystem, code: c.code, display: c.codeDisplay } : { system: c.codeSystem, code: c.code }];
    if (c.codeSystem !== CODE_SYSTEMS.snomed) {
      warnings.push(warning(ctx, "Condition", "code", `coded in ${c.codeSystem}, not SNOMED CT; ABDM requires SNOMED CT for Condition.code`));
    }
  } else {
    code.coding = [{ system: MEDPASS_SYSTEMS.csCondition, code: c.id, display: c.label }];
    warnings.push(warning(ctx, "Condition", "code", `no SNOMED CT mapping for "${c.label}"; exported with the local CodeSystem and text`));
  }

  const resource: ConditionResource = {
    resourceType: "Condition",
    id: c.id,
    meta: { profile: [ctx.profileUrl] },
    verificationStatus: {
      coding: [{ system: CODE_SYSTEMS.conditionVerification, code: confirmed ? "confirmed" : "unconfirmed" }],
    },
    category: [{ coding: [{ system: CODE_SYSTEMS.conditionCategory, code: "problem-list-item", display: "Problem List Item" }] }],
    code,
    subject: patientReference(c.patient),
    recordedDate: c.provenance.recordedAt,
  };
  const clinical = CLINICAL_TO_FHIR[c.clinicalStatus];
  if (clinical) resource.clinicalStatus = { coding: [{ system: CODE_SYSTEMS.conditionClinical, code: clinical }] };
  if (c.severity) resource.severity = { text: c.severity };
  if (c.onsetDate) resource.onsetDateTime = c.onsetDate;
  if (c.abatementDate) resource.abatementDateTime = c.abatementDate;
  if (c.encounterId) resource.encounter = reference("Encounter", c.encounterId);
  if (c.diagnosedByPractitionerId) resource.asserter = reference("Practitioner", c.diagnosedByPractitionerId);
  if (c.note) resource.note = [{ text: c.note }];
  return { resource, warnings };
}

/** R4 `Condition` → canonical candidate (provenance is stamped by the importer, docs_v2/08 §7). */
export function resourceToCondition(resource: ConditionResource): CanonicalConditionCandidate {
  const rt = "Condition";
  if (resource.resourceType !== rt) throw new FhirParseError(rt, "resourceType", `expected ${rt}, got ${String(resource.resourceType)}`);
  if (!resource.id) throw new FhirParseError(rt, "id", "id is required");
  const coding = resource.code?.coding?.find((x) => x.system !== MEDPASS_SYSTEMS.csCondition) ?? resource.code?.coding?.[0];
  const label = resource.code?.text ?? coding?.display;
  if (!label) throw new FhirParseError(rt, "code", "code.text or code.coding[0].display is required");
  const clinicalCode = resource.clinicalStatus?.coding?.find((x) => !x.system || x.system === CODE_SYSTEMS.conditionClinical)?.code;
  const clinicalStatus = (Object.entries(CLINICAL_TO_FHIR).find(([, v]) => v === clinicalCode)?.[0] as ConditionClinicalStatus | undefined) ?? "unknown";
  const local = coding?.system === MEDPASS_SYSTEMS.csCondition;
  return {
    id: resource.id,
    patient: parsePatientReference(resource.subject, rt),
    label,
    clinicalStatus,
    onsetDate: resource.onsetDateTime ?? null,
    abatementDate: resource.abatementDateTime ?? null,
    codeSystem: local ? null : (coding?.system ?? null),
    code: local ? null : (coding?.code ?? null),
    codeDisplay: local ? null : (coding?.display ?? null),
    severity: resource.severity?.text ?? null,
    note: resource.note?.[0]?.text ?? null,
    diagnosedByPractitionerId: null,
    encounterId: null,
  };
}

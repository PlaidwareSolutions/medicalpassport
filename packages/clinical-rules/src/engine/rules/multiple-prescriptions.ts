/**
 * Multiple active prescriptions (docs_v2/06 P2-3, docs_v2/10 §3): the same
 * normalized ingredient set is recorded as a *current* medicine under two
 * or more different prescription records. Nothing here judges whether that
 * is wrong — a second doctor may well have re-issued the same medicine — it
 * only surfaces that both records are marked current so the patient can
 * confirm which applies (docs/02: explain, never recommend).
 *
 * Only confirmed matches are compared (same exclusion as the duplication
 * rules); medicines with no prescription on file are a normal, fully-valid
 * entry and never contribute to this finding.
 */

import {
  PRESCRIPTION_RECORDS_SOURCE,
  RULE_VERSIONS,
  groupByIngredientSet,
  type MedicationSnapshot,
  type PrescriptionSnapshot,
  type RawFinding,
} from "../types.js";

type Prescribed = MedicationSnapshot & { prescription: PrescriptionSnapshot };

/** "Dr. Sharma, 2026-07-20" — falls back to the medicine's own name for a blank prescription. */
function prescriptionLabel(prescription: PrescriptionSnapshot, medicationName: string): string {
  const parts = [prescription.practitionerName, prescription.prescribedAt].filter(
    (p): p is string => typeof p === "string" && p.trim() !== "",
  );
  return parts.length > 0 ? parts.join(", ") : medicationName;
}

export function findMultipleActivePrescriptions(medications: MedicationSnapshot[]): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const group of groupByIngredientSet(medications)) {
    const prescribed = group.filter((m): m is Prescribed => !!m.prescription?.id);
    const prescriptionIds = [...new Set(prescribed.map((m) => m.prescription.id))];
    if (prescriptionIds.length < 2) continue;

    const medicationIds = prescribed.map((m) => m.id);
    findings.push({
      category: "multiple_active_prescriptions",
      severity: "moderate",
      medicationIds,
      ruleKey: RULE_VERSIONS.multipleActivePrescriptions.key,
      ruleVersion: RULE_VERSIONS.multipleActivePrescriptions.version,
      sourceName: PRESCRIPTION_RECORDS_SOURCE,
      explanationKey: "safety.explain.multiple_active_prescriptions",
      detail: {
        ingredientNames: prescribed[0]!.ingredientNames,
        medicationNames: prescribed.map((m) => m.name),
        prescriptionIds,
        prescriptions: prescribed.map((m) => ({
          id: m.prescription.id,
          prescribedAt: m.prescription.prescribedAt ?? null,
          practitionerName: m.prescription.practitionerName ?? null,
          medicationId: m.id,
          medicationName: m.name,
        })),
        /** Pre-rendered for the {prescriptions} explanation parameter. */
        prescriptionLabels: prescribed.map((m) => prescriptionLabel(m.prescription, m.name)),
        evidence: { medicationIds, prescriptionIds },
      },
    });
  }
  return findings;
}

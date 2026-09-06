#!/usr/bin/env node
/**
 * CI guard for ADR-V2-002: every clinical model listed below must carry the
 * full provenance block (docs_v2/04 §1.2). Run: `node scripts/check-provenance.mjs`
 * from packages/database. Exit 1 with a readable list on any gap.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "..", "prisma", "schema.prisma"), "utf8");

export const PROVENANCE_MODELS = [
  "PatientMedication",
  "MedicationInstruction",
  "Prescription",
  "PatientAllergy",
  "PatientCondition",
  "MedicalReport",
  "ReportValue",
  "GlucoseReading",
  "BloodPressureReading",
  "WeightReading",
  "CheckupRecord",
  "Encounter",
  "Immunization",
  "Procedure",
  "FamilyHistory",
  // wave 2 (phases 2–5)
  "PrescriptionItem",
  "MedicationDispense",
  "PatientDocument",
  "DiagnosticReport",
  "DiagnosticResult",
  "Observation",
];

export const PROVENANCE_FIELDS = [
  "provenanceSource",
  "verification",
  "recordedVia",
  "recordedByUserId",
  "sourceDocumentId",
  "sourceExtractionId",
  "sourceDeviceId",
  "sourceAbdmTxnId",
  "sourceOrganizationId",
  "sourcePractitionerId",
  "verifiedByUserId",
  "verifiedAt",
];

function modelBody(name) {
  const m = new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, "m").exec(schema);
  return m ? m[1] : null;
}

const problems = [];
for (const model of PROVENANCE_MODELS) {
  const body = modelBody(model);
  if (!body) {
    problems.push(`${model}: model not found in schema.prisma`);
    continue;
  }
  for (const field of PROVENANCE_FIELDS) {
    if (!new RegExp(`^\\s+${field}\\s`, "m").test(body)) problems.push(`${model}: missing ${field}`);
  }
}

if (problems.length > 0) {
  console.error("Provenance block check failed (ADR-V2-002):\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`Provenance block present on ${PROVENANCE_MODELS.length} models.`);

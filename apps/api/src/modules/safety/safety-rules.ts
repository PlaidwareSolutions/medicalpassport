/**
 * Deterministic safety rules — thin adapter over `@medpass/clinical-rules`
 * (docs_v2/06 P2-4, docs_v2/10 §3). The engine itself lives in
 * packages/clinical-rules; this module only re-exports it so the evaluation
 * service, the admin-rules controller and the existing specs keep their
 * import paths.
 *
 * The package takes plain snapshot types, not Prisma rows — the mapping from
 * database rows to snapshots happens in SafetyEvaluationService.
 */

export {
  evaluateSafety,
  RULE_VERSIONS,
  type AllergySnapshot,
  type InstructionSnapshot,
  type MedicationSnapshot,
  type RawFinding,
  type Severity,
} from "@medpass/clinical-rules";

/**
 * Clinical-rules package — the deterministic safety engine (docs_v2/10 §3)
 * plus the finding-type vocabulary and presentation constants shared with
 * clients.
 *
 * The engine executes ONLY on Railway (API/worker). Nothing in this package
 * may ever be evaluated in a browser, service worker, native client, or
 * Cloudflare Worker (docs/02 non-negotiable rule 6). Clients import the
 * presentation constants only; they render findings but never compute them.
 */

export * from "./presentation.js";

export { evaluateSafety } from "./engine/evaluate.js";
export {
  RULE_VERSIONS,
  type AllergySnapshot,
  type InstructionSnapshot,
  type MedicationSnapshot,
  type PrescriptionSnapshot,
  type RawFinding,
  type Severity,
} from "./engine/types.js";

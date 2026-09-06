import type { ActorKind } from "./actor.js";
import type { RecordSource } from "./record-source.js";
import type { VerificationState } from "./verification-state.js";

/**
 * Verification state a freshly created row starts in, given where it came
 * from and who is saving it. Conservative by design: anything not explicitly
 * vouched for by an entitled actor starts `unverified`.
 *
 * - user/caregiver-entered by the patient or a caregiver: `patient_confirmed`
 *   (the person saving it is confirming it).
 * - ocr_extracted / abdm_imported: `unverified` until confirmed. An ABDM
 *   gateway import is the one exception: it arrives `source_authenticated`
 *   (docs_v2/04 §1.2 "ABDM/lab-API imports arrive as source_authenticated").
 * - lab_imported via `lab_system`: `source_authenticated`.
 * - clinic_entered / pharmacy_entered via a provider actor: `provider_verified`.
 * - device_recorded, system_derived: `unverified`.
 */
export function initialVerificationFor(source: RecordSource, actor: ActorKind): VerificationState {
  switch (source) {
    case "user_entered":
    case "caregiver_entered":
      return actor === "patient" || actor === "caregiver" ? "patient_confirmed" : "unverified";
    case "clinic_entered":
    case "pharmacy_entered":
      return actor === "provider_verified_practitioner" || actor === "provider_organization"
        ? "provider_verified"
        : "unverified";
    case "lab_imported":
      return actor === "lab_system" ? "source_authenticated" : "unverified";
    case "abdm_imported":
      return actor === "abdm_gateway" ? "source_authenticated" : "unverified";
    case "ocr_extracted":
    case "device_recorded":
    case "system_derived":
      return "unverified";
  }
}

import { ERROR_CODES } from "@medpass/domain";
import {
  findClientProvenanceKeys,
  initialVerificationFor,
  isRecordedVia,
  verificationRank,
  type ActorKind,
  type RecordSource,
  type RecordedVia,
  type VerificationState,
} from "@medpass/provenance";
import { ApiProblem } from "./errors";
import type { ApiRequest } from "./http";

/**
 * Server-side provenance stamping (ADR-V2-002, docs_v2/04 §1.2). Clients never
 * set provenance; every write path derives it from the authenticated principal
 * and the channel header, and rejects any attempt to send it in the body.
 * Services that only hold an `{ userId, actorRole }` actor use the twin in
 * ./provenance-actor.ts.
 */

/** The provenance columns a create spreads into its Prisma `data`. */
export interface ProvenanceStamp {
  provenanceSource: RecordSource;
  verification: VerificationState;
  recordedVia: RecordedVia;
  recordedByUserId: string;
}

/** The actual column name on every provenance-bearing model, on top of the doc-level key names. */
const CLIENT_FORBIDDEN_EXTRA_KEYS = ["provenanceSource"] as const;

/** Patient/caregiver principals only for now; provider/lab/ABDM actors arrive with their own guards later. */
export function actorKindFor(req: ApiRequest): ActorKind {
  return req.profileContext?.actorRole === "caregiver" ? "caregiver" : "patient";
}

/** Where a value typed in by this request's principal comes from. */
export function entrySourceFor(req: ApiRequest): RecordSource {
  return req.profileContext?.actorRole === "caregiver" ? "caregiver_entered" : "user_entered";
}

/**
 * `x-client` names the channel that wrote the row (`pwa`, `native_android`,
 * …). Absent means the PWA; an unknown value is a 400, never free text.
 */
export function recordedViaFor(req: ApiRequest): RecordedVia {
  const header = req.header("x-client");
  if (header === undefined || header === "") return "pwa";
  if (isRecordedVia(header)) return header;
  throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown x-client header", 400, [
    { path: "x-client", message: "Not a recognised client channel" },
  ]);
}

/**
 * Provenance for a row this request creates. `verification` starts at the
 * conservative initial state for (source, actor) — a patient or caregiver
 * saving their own entry reaches `patient_confirmed`, never higher; an
 * OCR-derived row starts `unverified` whoever confirms it. Call after
 * `ProfileAccessService.require()` so `profileContext.actorRole` is set.
 */
export function stampProvenance(req: ApiRequest, source: RecordSource): ProvenanceStamp {
  if (!req.auth) throw new ApiProblem(ERROR_CODES.UNAUTHENTICATED, "Sign in to continue", 401);
  return {
    provenanceSource: source,
    verification: initialVerificationFor(source, actorKindFor(req)),
    recordedVia: recordedViaFor(req),
    recordedByUserId: req.auth.userId,
  };
}

/**
 * Provenance for an edit: the editor becomes the row's source/channel/
 * recorder, but `verification` is monotonic (ADR-V2-002) — an edit never
 * lowers a state a more entitled actor already set.
 */
export function restampProvenance(existing: VerificationState | null | undefined, stamp: ProvenanceStamp): ProvenanceStamp {
  if (existing && verificationRank(existing) > verificationRank(stamp.verification)) {
    return { ...stamp, verification: existing };
  }
  return stamp;
}

/**
 * 400 `provenance_not_client_settable` when the body carries any provenance
 * key, even as `null`/`undefined` — presence is the violation. Runs before
 * Zod parsing so a non-strict schema cannot quietly drop the attempt.
 */
export function rejectClientProvenance(body: unknown): void {
  const keys: string[] = [...findClientProvenanceKeys(body)];
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    for (const key of CLIENT_FORBIDDEN_EXTRA_KEYS) {
      if (Object.prototype.hasOwnProperty.call(body, key)) keys.push(key);
    }
  }
  if (keys.length === 0) return;
  throw new ApiProblem(
    ERROR_CODES.PROVENANCE_NOT_CLIENT_SETTABLE,
    "Provenance is recorded by the server and cannot be set by the client",
    400,
    keys.map((path) => ({ path, message: "Not client-settable" })),
  );
}

/**
 * Sources whose rows may carry an `interpretation` (docs_v2/04 §5.2, §6.3).
 * A lab's printed "H"/"L" flag and a clinician's own reading are clinical
 * judgements made by someone qualified to make them; everything else —
 * including this server — must leave the field null. Hazard H-25: the app
 * never interprets a value, and never derives a flag from a threshold.
 */
const INTERPRETATION_SOURCES: readonly RecordSource[] = ["lab_imported", "clinic_entered"];

export function mayCarryInterpretation(source: RecordSource): boolean {
  return INTERPRETATION_SOURCES.includes(source);
}

/**
 * 400 `interpretation_not_client_settable` when a non-provider write tries
 * to set one. The value is *refused*, never silently dropped: quietly
 * discarding a lab's "critical high" would be the more dangerous failure,
 * because the caller would believe it had been stored.
 */
export function rejectClientInterpretation(interpretation: unknown, source: RecordSource): void {
  if (interpretation === undefined || interpretation === null) return;
  if (mayCarryInterpretation(source)) return;
  throw new ApiProblem(
    ERROR_CODES.INTERPRETATION_NOT_CLIENT_SETTABLE,
    "Normal/high/low flags come from the lab or the clinic — this app never decides them",
    400,
    [{ path: "interpretation", message: "Only a lab or clinic record may carry this flag" }],
  );
}

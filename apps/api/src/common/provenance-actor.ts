import { initialVerificationFor, isRecordedVia, type RecordSource } from "@medpass/provenance";
import type { ProvenanceStamp } from "./provenance";

/**
 * Actor-based twin of `stampProvenance(req, source)` in ./provenance.ts for
 * services that receive an `{ userId, actorRole }` actor rather than the
 * request (medications, prescriptions, reports, encounters, and the offline
 * sync replay, which has no per-mutation request at all). Same rules
 * (ADR-V2-002): the source follows the role unless the caller names one
 * (`ocr_extracted` for an extraction confirm), `verification` starts at the
 * conservative initial state, and the channel is the validated `x-client`
 * value the controller captured — "pwa" when it had none.
 */
export interface ProvenanceActor {
  userId: string;
  actorRole: "patient" | "caregiver";
  /** Validated `x-client` value captured by the controller (`recordedViaFor(req)`); defaults to "pwa". */
  recordedVia?: string;
}

export function stampProvenanceFor(actor: ProvenanceActor, options: { source?: RecordSource } = {}): ProvenanceStamp {
  const source: RecordSource = options.source ?? (actor.actorRole === "caregiver" ? "caregiver_entered" : "user_entered");
  return {
    provenanceSource: source,
    verification: initialVerificationFor(source, actor.actorRole),
    recordedVia: isRecordedVia(actor.recordedVia) ? actor.recordedVia : "pwa",
    recordedByUserId: actor.userId,
  };
}

import { PROVENANCE_KEYS, type ProvenanceKey } from "./provenance-block.js";

/**
 * Thrown when a client-supplied payload tries to set provenance. Clients never
 * set provenance; services stamp it (ADR-V2-002).
 */
export class ClientProvenanceError extends Error {
  override readonly name = "ClientProvenanceError";
  readonly code = "validation_failed" as const;
  constructor(readonly keys: readonly ProvenanceKey[]) {
    super(`client payload may not set provenance field(s): ${keys.join(", ")}`);
  }
}

/** Returns the provenance keys present on `payload` (own enumerable keys only). */
export function findClientProvenanceKeys(payload: unknown): ProvenanceKey[] {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return [];
  const present = new Set(Object.keys(payload));
  return PROVENANCE_KEYS.filter((key) => present.has(key));
}

/**
 * Throws {@link ClientProvenanceError} if `payload` contains any provenance
 * key, even with an `undefined`/`null` value. Presence is the violation.
 */
export function assertNoClientProvenance(payload: unknown): void {
  const keys = findClientProvenanceKeys(payload);
  if (keys.length > 0) throw new ClientProvenanceError(keys);
}

/** Non-throwing variant: returns a copy of `payload` with provenance keys removed. */
export function stripClientProvenance<T extends object>(payload: T): Omit<T, ProvenanceKey> {
  const out: Record<string, unknown> = {};
  const banned = new Set<string>(PROVENANCE_KEYS);
  for (const [key, value] of Object.entries(payload)) {
    if (!banned.has(key)) out[key] = value;
  }
  return out as Omit<T, ProvenanceKey>;
}

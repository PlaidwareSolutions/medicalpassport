/**
 * Who is performing a provenance-affecting action. Services derive this from
 * the authenticated principal; clients never supply it.
 */
export const ACTOR_KINDS = [
  "patient",
  "caregiver",
  "provider_verified_practitioner",
  "provider_organization",
  "lab_system",
  "abdm_gateway",
  "system",
  "admin",
] as const;

export type ActorKind = (typeof ACTOR_KINDS)[number];

export function isActorKind(value: unknown): value is ActorKind {
  return typeof value === "string" && (ACTOR_KINDS as readonly string[]).includes(value);
}

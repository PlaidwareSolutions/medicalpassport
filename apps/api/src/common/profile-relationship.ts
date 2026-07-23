/**
 * Shared by profiles.controller.ts's list() and auth.controller.ts's
 * sessionResponse() — both need to tell a signed-in user their relationship
 * to every profile they can reach. Kept in one place so a profile is never
 * independently miscomputed in one call site but not the other.
 *
 * A caregiver-created dependent profile has the *same* ownerUserId as the
 * caregiver's own profile — there's no separate account for the dependent
 * until someone actually claims it — so a single profile row alone can't
 * tell "this is my own profile" apart from "this is a profile I created to
 * manage on someone else's behalf" (a real bug: both used to compute as
 * "self" for the creator). The owner's true self profile is always the
 * earliest-created row they own (onboarding always creates it first, and
 * profiles.controller.ts's create() rejects creating a second one), so
 * telling them apart needs the caller's *whole* profile list, not one row.
 */
export interface ProfileRelationshipInput {
  id: string;
  ownerUserId: string;
  claimedByUserId: string | null;
  createdAt: Date;
}

export type ProfileRelationship = "self" | "dependent" | "caregiver";

export function computeProfileRelationships(
  profiles: ProfileRelationshipInput[],
  userId: string,
): Map<string, ProfileRelationship> {
  let selfId: string | undefined;
  let selfCreatedAt: Date | undefined;
  for (const p of profiles) {
    if (p.ownerUserId === userId && p.claimedByUserId === null) {
      if (!selfCreatedAt || p.createdAt < selfCreatedAt) {
        selfId = p.id;
        selfCreatedAt = p.createdAt;
      }
    }
  }

  const result = new Map<string, ProfileRelationship>();
  for (const p of profiles) {
    if (p.claimedByUserId) {
      result.set(p.id, p.claimedByUserId === userId ? "self" : "caregiver");
    } else if (p.ownerUserId !== userId) {
      result.set(p.id, "caregiver");
    } else {
      result.set(p.id, p.id === selfId ? "self" : "dependent");
    }
  }
  return result;
}

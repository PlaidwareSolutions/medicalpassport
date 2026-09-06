/**
 * Local-only bootstrap for a provider organization and its first owner.
 * There is no self-serve organization creation on the API (the first owner
 * comes from the admin portal / pilot onboarding), so a developer — and the
 * e2e suite — seeds one straight into the database, then signs in through
 * the real routes with the fixed dev OTP.
 *
 *   pnpm --filter @medpass/provider-web seed:dev-org -- --kind clinic --name "Sunrise Clinic" --phone +919000000001
 *
 * Needs DATABASE_URL, OTP_HASH_PEPPER and FIELD_ENCRYPTION_KEY set to the
 * SAME values the API runs with (the phone digest and ciphertext must
 * match what the API computes at sign-in). Mirrors
 * apps/api/test/helpers/provider.ts#seedOrganization; duplicated rather
 * than imported because apps never depend on other apps.
 */
import { createHmac } from "node:crypto";
import { disconnectPrisma, getPrisma } from "@medpass/database";
import { createFieldCrypto, keyringFromEnv } from "@medpass/field-crypto";

export type SeedOrganizationKind = "clinic" | "hospital" | "pharmacy" | "laboratory" | "diagnostic_centre" | "other";

export interface SeedOrganizationOptions {
  kind: SeedOrganizationKind;
  displayName: string;
  /** E.164, e.g. +919000000001 */
  ownerPhone: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (use the same value as the API)`);
  return value;
}

/** Same derivation as apps/api/src/common/crypto.ts#phoneDigest. */
function phoneDigest(phoneE164: string): string {
  return createHmac("sha256", requireEnv("OTP_HASH_PEPPER") + ":phone").update(phoneE164).digest("hex");
}

function encryptPhone(phoneE164: string): string {
  const crypto = createFieldCrypto(
    keyringFromEnv({
      FIELD_ENCRYPTION_KEY: requireEnv("FIELD_ENCRYPTION_KEY"),
      FIELD_ENCRYPTION_KEYS: process.env.FIELD_ENCRYPTION_KEYS,
      FIELD_ENCRYPTION_ACTIVE_KEY_VERSION: process.env.FIELD_ENCRYPTION_ACTIVE_KEY_VERSION,
    }),
  );
  return crypto.encrypt(phoneE164);
}

export async function seedDevOrganization(opts: SeedOrganizationOptions): Promise<{ organizationId: string; ownerUserId: string }> {
  if (!/^\+[1-9]\d{7,14}$/.test(opts.ownerPhone)) throw new Error("ownerPhone must be E.164, e.g. +919000000001");
  const prisma = getPrisma();
  const digest = phoneDigest(opts.ownerPhone);
  let user = await prisma.user.findUnique({ where: { phoneDigest: digest } });
  if (!user) {
    user = await prisma.user.create({
      data: { phoneDigest: digest, phoneCiphertext: encryptPhone(opts.ownerPhone), userKind: "provider", phoneVerifiedAt: new Date() },
    });
  } else if (user.userKind === "patient") {
    user = await prisma.user.update({ where: { id: user.id }, data: { userKind: "both" } });
  }
  const organization = await prisma.organization.create({ data: { kind: opts.kind, displayName: opts.displayName } });
  await prisma.organizationMember.create({ data: { organizationId: organization.id, userId: user.id, role: "owner" } });
  return { organizationId: organization.id, ownerUserId: user.id };
}

/**
 * Test convenience mirroring apps/api/test/helpers/step-up.ts: the API's
 * 30-second resend cooldown counts a login code and a step-up code to the
 * same number together, so a spec that signs in and then steps up clears
 * the already-consumed attempts first. Unconsumed attempts are left alone.
 */
export async function clearConsumedOtps(phoneE164: string): Promise<void> {
  await getPrisma().otpAttempt.deleteMany({ where: { phoneDigest: phoneDigest(phoneE164), consumedAt: { not: null } } });
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const kind = (argValue("--kind") ?? "clinic") as SeedOrganizationKind;
  const displayName = argValue("--name") ?? "Dev Clinic";
  const ownerPhone = argValue("--phone") ?? "+919000000001";
  const result = await seedDevOrganization({ kind, displayName, ownerPhone });
  // Opaque ids only — the phone is what the caller passed in, not logged again.
  console.log(`Seeded ${kind} "${displayName}": organization ${result.organizationId}, owner user ${result.ownerUserId}.`);
  console.log("Sign in at the provider portal with that phone; with OTP_TRANSPORT=log the code is OTP_DEV_FIXED_CODE (000000).");
}

// Run as a script (tsx scripts/seed-dev-org.ts); importing the module (the e2e spec) runs nothing.
if (process.argv[1] && /seed-dev-org\.[cm]?[jt]s$/.test(process.argv[1])) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => disconnectPrisma());
}

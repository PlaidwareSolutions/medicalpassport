import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createFieldCrypto } from "@medpass/field-crypto";
import { getPrisma, type PrismaClient } from "@medpass/database";
import { ENCRYPTED_COLUMNS, rotateFieldEncryption } from "./rotate-field-encryption";

/**
 * Guard: every `*Ciphertext` column in schema.prisma must be in the rotation
 * list. This is the check that was missing when three encrypted columns were
 * added and the rotation job silently skipped them.
 */
describe("ENCRYPTED_COLUMNS covers the schema", () => {
  it("lists exactly the *Ciphertext columns declared in schema.prisma", () => {
    const schema = readFileSync(resolve(__dirname, "../../../../packages/database/prisma/schema.prisma"), "utf8");
    const found = new Set<string>();
    let model: string | null = null;
    for (const raw of schema.split("\n")) {
      const line = raw.replace(/\r$/, "");
      const open = /^model\s+(\w+)\s*\{/.exec(line);
      if (open) model = open[1]!;
      else if (/^\}/.test(line)) model = null;
      else if (model) {
        const field = /^\s+(\w+Ciphertext)\s+String\??/.exec(line);
        if (field) found.add(`${model}.${field[1]}`);
      }
    }
    const listed = new Set(ENCRYPTED_COLUMNS.map((c) => `${c.model}.${c.field}`));
    expect([...found].sort()).toEqual([...listed].sort());
  });
});

/**
 * The rotation walks EVERY row of every listed table, so it must read the
 * rows other tests (and, on a laptop, the developer) have written with the
 * environment's real key. Version 1 is therefore that key, version 2 is a
 * throwaway, and the whole pass runs inside a transaction that is rolled
 * back — nothing on the shared database is left re-encrypted under a key
 * the running API does not have.
 */
class Rollback extends Error {}

describe.skipIf(!process.env.DATABASE_URL || !process.env.FIELD_ENCRYPTION_KEY)("rotateFieldEncryption (postgres)", () => {
  const realKey = process.env.FIELD_ENCRYPTION_KEY!;
  const v1 = createFieldCrypto({ keys: { 1: realKey }, activeVersion: 1 });
  const v2 = createFieldCrypto({ keys: { 1: realKey, 2: "new-key-for-rotation-test-32bytes!!" }, activeVersion: 2 });
  const plain = { phone: "+919999900001", address: "https://push.example/endpoint", mfa: "JBSWY3DPEHPK3PXP", orgPhone: "+914012345678", contactPhone: "+919999900002", abha: "91-1234-5678-9012" };

  async function withSeededRows<T>(run: (tx: PrismaClient, ids: Record<string, string>) => Promise<T>): Promise<T> {
    const prisma = getPrisma();
    const tag = `rotate-test-${randomUUID().slice(0, 8)}`;
    let result: T | undefined;
    try {
      await prisma.$transaction(
        async (tx) => {
          const user = await tx.user.create({ data: { phoneDigest: `${tag}-user`, phoneCiphertext: v1.encrypt(plain.phone) } });
          const profile = await tx.patientProfile.create({ data: { ownerUserId: user.id, displayName: tag, timezone: "Asia/Kolkata" } });
          const channel = await tx.notificationChannel.create({
            data: { userId: user.id, channel: "web_push", addressCiphertext: v1.encrypt(plain.address), endpointDigest: `${tag}-endpoint` },
          });
          const admin = await tx.adminUser.create({ data: { email: `${tag}@example.test`, passwordHash: "x", duties: [], mfaSecretCiphertext: v1.encrypt(plain.mfa) } });
          const org = await tx.organization.create({ data: { kind: "clinic", displayName: tag, phoneCiphertext: v1.encrypt(plain.orgPhone) } });
          const contact = await tx.emergencyContact.create({
            data: { patientProfileId: profile.id, name: "Contact", phoneCiphertext: v1.encrypt(plain.contactPhone), priority: 1, recordedByUserId: user.id },
          });
          const abha = await tx.abhaLink.create({
            data: { patientProfileId: profile.id, abhaNumberCiphertext: v1.encrypt(plain.abha), abhaNumberDigest: `${tag}-abha`, status: "active", linkedAt: new Date() },
          });
          result = await run(tx as unknown as PrismaClient, { user: user.id, channel: channel.id, admin: admin.id, org: org.id, contact: contact.id, abha: abha.id });
          throw new Rollback();
        },
        { timeout: 120_000 },
      );
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
    return result as T;
  }

  it("re-encrypts every listed column onto the active version, and each value still reads back", async () => {
    await withSeededRows(async (tx, ids) => {
      const summary = await rotateFieldEncryption(tx, v2, 50);
      for (const model of ENCRYPTED_COLUMNS.map((c) => c.model)) expect(summary.rotated[model]).toBeGreaterThanOrEqual(1);
      expect(summary.stillStale).toBe(0);

      const [user, channel, admin, org, contact, abha] = await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: ids.user! } }),
        tx.notificationChannel.findUniqueOrThrow({ where: { id: ids.channel! } }),
        tx.adminUser.findUniqueOrThrow({ where: { id: ids.admin! } }),
        tx.organization.findUniqueOrThrow({ where: { id: ids.org! } }),
        tx.emergencyContact.findUniqueOrThrow({ where: { id: ids.contact! } }),
        tx.abhaLink.findUniqueOrThrow({ where: { id: ids.abha! } }),
      ]);
      // The three columns the old job missed are the ones that matter most here.
      expect(v2.isStale(org.phoneCiphertext!)).toBe(false);
      expect(v2.decrypt(org.phoneCiphertext!)).toBe(plain.orgPhone);
      expect(v2.isStale(contact.phoneCiphertext)).toBe(false);
      expect(v2.decrypt(contact.phoneCiphertext)).toBe(plain.contactPhone);
      expect(v2.isStale(abha.abhaNumberCiphertext)).toBe(false);
      expect(v2.decrypt(abha.abhaNumberCiphertext)).toBe(plain.abha);
      expect(v2.decrypt(user.phoneCiphertext)).toBe(plain.phone);
      expect(v2.decrypt(channel.addressCiphertext)).toBe(plain.address);
      expect(v2.decrypt(admin.mfaSecretCiphertext!)).toBe(plain.mfa);

      // Idempotent: a second pass inside the same transaction rewrites nothing.
      const again = await rotateFieldEncryption(tx, v2, 50);
      expect(Object.values(again.rotated).every((n) => n === 0)).toBe(true);
      expect(again.stillStale).toBe(0);
    });
  });
});

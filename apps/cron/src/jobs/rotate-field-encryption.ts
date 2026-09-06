/**
 * rotate-field-encryption (docs_v2/11 §4, docs_v2/12 §6, runbook R-KEY-1).
 *
 * Re-encrypts every application-level ciphertext that is not on the active
 * keyring version. Run after adding a new key to FIELD_ENCRYPTION_KEYS and
 * pointing FIELD_ENCRYPTION_ACTIVE_KEY_VERSION at it; once this reports
 * zero stale rows the retired key can be removed from the keyring.
 *
 * Idempotent and resumable: each row is rewritten independently and only
 * when stale, so a re-run after a crash simply continues. Never logs
 * plaintext or ciphertext; only counts.
 */
import { createFieldCrypto, keyringFromEnv } from "@medpass/field-crypto";
import { runJob } from "../lib/run-job";

const BATCH = 500;

runJob("rotate-field-encryption", async ({ prisma, config, log }) => {
  const crypto = createFieldCrypto(
    keyringFromEnv({
      FIELD_ENCRYPTION_KEY: config.FIELD_ENCRYPTION_KEY,
      FIELD_ENCRYPTION_KEYS: config.FIELD_ENCRYPTION_KEYS,
      FIELD_ENCRYPTION_ACTIVE_KEY_VERSION: config.FIELD_ENCRYPTION_ACTIVE_KEY_VERSION,
    }),
  );

  const summary = { activeVersion: crypto.activeVersion, users: 0, notificationChannels: 0, adminUsers: 0, stillStale: 0 };

  // users.phone_ciphertext
  for (let cursor: string | undefined; ; ) {
    const rows = await prisma.user.findMany({
      select: { id: true, phoneCiphertext: true },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      if (!crypto.isStale(row.phoneCiphertext)) continue;
      await prisma.user.update({ where: { id: row.id }, data: { phoneCiphertext: crypto.rotate(row.phoneCiphertext) } });
      summary.users += 1;
    }
    cursor = rows[rows.length - 1]!.id;
  }

  // notification_channels.address_ciphertext
  for (let cursor: string | undefined; ; ) {
    const rows = await prisma.notificationChannel.findMany({
      select: { id: true, addressCiphertext: true },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      if (!crypto.isStale(row.addressCiphertext)) continue;
      await prisma.notificationChannel.update({
        where: { id: row.id },
        data: { addressCiphertext: crypto.rotate(row.addressCiphertext) },
      });
      summary.notificationChannels += 1;
    }
    cursor = rows[rows.length - 1]!.id;
  }

  // admin_users.mfa_secret_ciphertext (nullable)
  const admins = await prisma.adminUser.findMany({ select: { id: true, mfaSecretCiphertext: true } });
  for (const admin of admins) {
    if (!admin.mfaSecretCiphertext || !crypto.isStale(admin.mfaSecretCiphertext)) continue;
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { mfaSecretCiphertext: crypto.rotate(admin.mfaSecretCiphertext) },
    });
    summary.adminUsers += 1;
  }

  // Report anything still stale (a version the keyring cannot read would
  // have thrown above; this catches rows written by a newer active version).
  const [users, channels] = await Promise.all([
    prisma.user.findMany({ select: { phoneCiphertext: true } }),
    prisma.notificationChannel.findMany({ select: { addressCiphertext: true } }),
  ]);
  summary.stillStale =
    users.filter((u) => crypto.isStale(u.phoneCiphertext)).length +
    channels.filter((c) => crypto.isStale(c.addressCiphertext)).length;
  if (summary.stillStale > 0) log.warn(summary, "rows remain on a non-active key version");
  return summary;
});

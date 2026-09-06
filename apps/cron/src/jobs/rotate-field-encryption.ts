/**
 * rotate-field-encryption (docs_v2/11 §4, docs_v2/12 §6, runbook R-KEY-1).
 *
 * Re-encrypts every application-level ciphertext that is not on the active
 * keyring version. Run after adding a new key to FIELD_ENCRYPTION_KEYS and
 * pointing FIELD_ENCRYPTION_ACTIVE_KEY_VERSION at it; once this reports
 * zero stale rows the retired key can be removed from the keyring.
 *
 * The list of encrypted columns lives in ../lib/rotate-field-encryption.ts,
 * guarded by a test against schema.prisma, so a new encrypted column cannot
 * be added without this job learning about it.
 */
import { createFieldCrypto, keyringFromEnv } from "@medpass/field-crypto";
import { rotateFieldEncryption } from "../lib/rotate-field-encryption";
import { runJob } from "../lib/run-job";

runJob("rotate-field-encryption", async ({ prisma, config, log }) => {
  const crypto = createFieldCrypto(
    keyringFromEnv({
      FIELD_ENCRYPTION_KEY: config.FIELD_ENCRYPTION_KEY,
      FIELD_ENCRYPTION_KEYS: config.FIELD_ENCRYPTION_KEYS,
      FIELD_ENCRYPTION_ACTIVE_KEY_VERSION: config.FIELD_ENCRYPTION_ACTIVE_KEY_VERSION,
    }),
  );
  const summary = await rotateFieldEncryption(prisma, crypto, 500, (model, id, reason) =>
    log.warn({ model, id, reason }, "ciphertext could not be read — skipped, needs a person"),
  );
  if (summary.stillStale > 0) log.warn(summary, "rows remain on a non-active key version");
  return { ...summary };
});

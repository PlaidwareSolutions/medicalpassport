import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Client-side encryption for backup exports (docs/27: "Backup exports
 * contain PHI ⇒ encrypted before leaving PG, keys held outside Railway").
 * Shared by backup-export.ts and restore-test.ts only — not promoted to a
 * cross-app package, since nothing outside apps/cron needs it.
 */
function deriveKey(base64Key: string): Buffer {
  return createHash("sha256").update(Buffer.from(base64Key, "base64")).digest();
}

export function encryptBackup(plaintext: Buffer, base64Key: string): Buffer {
  const key = deriveKey(base64Key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBackup(encrypted: Buffer, base64Key: string): Buffer {
  const key = deriveKey(base64Key);
  const iv = encrypted.subarray(0, 12);
  const tag = encrypted.subarray(12, 28);
  const ciphertext = encrypted.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

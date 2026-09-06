import { createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { createFieldCrypto, keyringFromEnv, type FieldCrypto } from "@medpass/field-crypto";
import { env } from "./env";

/** Deterministic digest for lookup/uniqueness of phone numbers (docs/18). */
export function phoneDigest(phoneE164: string): string {
  return createHmac("sha256", env().OTP_HASH_PEPPER + ":phone").update(phoneE164).digest("hex");
}

/**
 * AES-256-GCM application-level encryption for stored identifiers, now backed
 * by the versioned keyring in @medpass/field-crypto (docs_v2/11 §4). Version 1
 * is FIELD_ENCRYPTION_KEY and keeps the V1 unprefixed wire format, so every
 * ciphertext already in the database decrypts unchanged.
 */
let fieldCryptoInstance: FieldCrypto | undefined;

export function fieldCrypto(): FieldCrypto {
  if (!fieldCryptoInstance) {
    const e = env();
    fieldCryptoInstance = createFieldCrypto(
      keyringFromEnv({
        FIELD_ENCRYPTION_KEY: e.FIELD_ENCRYPTION_KEY,
        FIELD_ENCRYPTION_KEYS: e.FIELD_ENCRYPTION_KEYS,
        FIELD_ENCRYPTION_ACTIVE_KEY_VERSION: e.FIELD_ENCRYPTION_ACTIVE_KEY_VERSION,
      }),
    );
  }
  return fieldCryptoInstance;
}

/** Test-only: reset the keyring so specs can vary the environment. */
export function resetFieldCryptoCache(): void {
  fieldCryptoInstance = undefined;
}

export function encryptField(plaintext: string): string {
  return fieldCrypto().encrypt(plaintext);
}

export function decryptField(ciphertext: string): string {
  return fieldCrypto().decrypt(ciphertext);
}

export function generateOtpCode(): string {
  const fixed = env().OTP_DEV_FIXED_CODE;
  if (fixed && env().NODE_ENV !== "production") return fixed;
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** OTPs are hashed with scrypt + pepper; never stored or logged in plaintext. */
export function hashOtp(code: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(env().OTP_HASH_PEPPER + code, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyOtp(code: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const candidate = scryptSync(env().OTP_HASH_PEPPER + code, Buffer.from(saltHex, "hex"), 32);
  const expected = Buffer.from(hashHex, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** Admin passwords are hashed with scrypt + a dedicated pepper (docs/18); never stored or logged in plaintext. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(env().ADMIN_PASSWORD_PEPPER + password, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const candidate = scryptSync(env().ADMIN_PASSWORD_PEPPER + password, Buffer.from(saltHex, "hex"), 32);
  const expected = Buffer.from(hashHex, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Session tokens are stored only as peppered SHA-256 hashes. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(env().SESSION_TOKEN_PEPPER + token).digest("hex");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

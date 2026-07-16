import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { env } from "./env";

/** Deterministic digest for lookup/uniqueness of phone numbers (docs/18). */
export function phoneDigest(phoneE164: string): string {
  return createHmac("sha256", env().OTP_HASH_PEPPER + ":phone").update(phoneE164).digest("hex");
}

/** AES-256-GCM application-level encryption for stored identifiers. */
export function encryptField(plaintext: string): string {
  const key = fieldKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decryptField(ciphertext: string): string {
  const key = fieldKey();
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function fieldKey(): Buffer {
  // Accept base64 or utf8 material; derive a stable 32-byte key.
  return createHash("sha256").update(env().FIELD_ENCRYPTION_KEY).digest();
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

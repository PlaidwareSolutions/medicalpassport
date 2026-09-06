import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Application-level field encryption with a versioned keyring (docs_v2/11 §4,
 * Phase 0 ticket 0.21). Replaces the single-key helpers that lived in
 * apps/api and were copy-pasted into apps/cron.
 *
 * Wire format
 *   legacy (V1):  base64( iv(12) || authTag(16) || ciphertext )
 *   V2:           "k<version>:" + base64( iv(12) || authTag(16) || ciphertext )
 *
 * The key version rides inside the ciphertext, so rotation needs no schema
 * change: decrypt picks the key by prefix (legacy → version 1), encrypt always
 * uses the active version, and a re-encrypt job simply rewrites rows whose
 * prefix is not the active one.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX_RE = /^k(\d+):/;

export interface FieldCryptoOptions {
  /** Version → key material (base64 or utf8; hashed to 32 bytes). Version 1 is the legacy `FIELD_ENCRYPTION_KEY`. */
  keys: Record<number, string>;
  /** Version used for new ciphertexts. Defaults to the highest version present. */
  activeVersion?: number;
}

export interface FieldCrypto {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
  /** Which key version a stored ciphertext uses (1 for legacy unprefixed values). */
  versionOf(ciphertext: string): number;
  /** True when a stored ciphertext is not on the active version (needs re-encryption). */
  isStale(ciphertext: string): boolean;
  /** Re-encrypts with the active key; returns the input unchanged when already current. */
  rotate(ciphertext: string): string;
  readonly activeVersion: number;
  readonly versions: readonly number[];
}

export class FieldCryptoError extends Error {
  constructor(
    message: string,
    readonly code: "unknown_key_version" | "malformed_ciphertext" | "no_keys",
  ) {
    super(message);
    this.name = "FieldCryptoError";
  }
}

function deriveKey(material: string): Buffer {
  // Accept base64 or utf8 material; derive a stable 32-byte key (same as V1).
  return createHash("sha256").update(material).digest();
}

/**
 * Parses the environment convention:
 *   FIELD_ENCRYPTION_KEY                = version 1 (required; legacy)
 *   FIELD_ENCRYPTION_KEYS               = "2:<material>,3:<material>" (optional, newer versions)
 *   FIELD_ENCRYPTION_ACTIVE_KEY_VERSION = number (optional; default highest)
 */
export function keyringFromEnv(env: {
  FIELD_ENCRYPTION_KEY: string;
  FIELD_ENCRYPTION_KEYS?: string;
  FIELD_ENCRYPTION_ACTIVE_KEY_VERSION?: number | string;
}): FieldCryptoOptions {
  const keys: Record<number, string> = { 1: env.FIELD_ENCRYPTION_KEY };
  if (env.FIELD_ENCRYPTION_KEYS) {
    for (const entry of env.FIELD_ENCRYPTION_KEYS.split(",")) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const sep = trimmed.indexOf(":");
      const version = Number(trimmed.slice(0, sep));
      const material = trimmed.slice(sep + 1);
      if (sep <= 0 || !Number.isInteger(version) || version < 2 || material.length < 32) {
        throw new FieldCryptoError(
          `FIELD_ENCRYPTION_KEYS entries must look like "<version>=2+>:<material of 32+ chars>"`,
          "malformed_ciphertext",
        );
      }
      keys[version] = material;
    }
  }
  const active =
    env.FIELD_ENCRYPTION_ACTIVE_KEY_VERSION !== undefined && env.FIELD_ENCRYPTION_ACTIVE_KEY_VERSION !== ""
      ? Number(env.FIELD_ENCRYPTION_ACTIVE_KEY_VERSION)
      : undefined;
  return { keys, activeVersion: active };
}

export function createFieldCrypto(options: FieldCryptoOptions): FieldCrypto {
  const versions = Object.keys(options.keys)
    .map(Number)
    .filter((v) => Number.isInteger(v) && v >= 1)
    .sort((a, b) => a - b);
  if (versions.length === 0) throw new FieldCryptoError("At least one key version is required", "no_keys");
  const derived = new Map<number, Buffer>(versions.map((v) => [v, deriveKey(options.keys[v]!)]));
  const activeVersion = options.activeVersion ?? versions[versions.length - 1]!;
  if (!derived.has(activeVersion)) {
    throw new FieldCryptoError(`Active key version ${activeVersion} is not in the keyring`, "unknown_key_version");
  }

  const keyFor = (version: number): Buffer => {
    const key = derived.get(version);
    if (!key) throw new FieldCryptoError(`No key for ciphertext version ${version}`, "unknown_key_version");
    return key;
  };

  const versionOf = (ciphertext: string): number => {
    const m = PREFIX_RE.exec(ciphertext);
    return m ? Number(m[1]) : 1;
  };

  const encryptWith = (version: number, plaintext: string): string => {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", keyFor(version), iv);
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const body = Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
    // Version 1 keeps the legacy unprefixed format so nothing already stored
    // ever needs rewriting just because this package replaced the helper.
    return version === 1 ? body : `k${version}:${body}`;
  };

  const decrypt = (ciphertext: string): string => {
    const version = versionOf(ciphertext);
    const body = version === 1 ? ciphertext : ciphertext.slice(ciphertext.indexOf(":") + 1);
    const buf = Buffer.from(body, "base64");
    if (buf.length < IV_BYTES + TAG_BYTES) throw new FieldCryptoError("Ciphertext too short", "malformed_ciphertext");
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const data = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", keyFor(version), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  };

  return {
    activeVersion,
    versions,
    encrypt: (plaintext) => encryptWith(activeVersion, plaintext),
    decrypt,
    versionOf,
    isStale: (ciphertext) => versionOf(ciphertext) !== activeVersion,
    rotate: (ciphertext) => (versionOf(ciphertext) === activeVersion ? ciphertext : encryptWith(activeVersion, decrypt(ciphertext))),
  };
}

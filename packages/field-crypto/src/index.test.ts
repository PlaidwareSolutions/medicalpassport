import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FieldCryptoError, createFieldCrypto, keyringFromEnv } from "./index";

const K1 = "ci-field-key-not-secret-32bytes!";
const K2 = "second-key-material-that-is-long-enough!";
const K3 = "third-key-material-that-is-long-enough!!";

/** Byte-for-byte the V1 apps/api encryptField, to prove backward compatibility. */
function legacyEncrypt(plaintext: string, material: string): string {
  const key = createHash("sha256").update(material).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

describe("field-crypto keyring", () => {
  it("single legacy key: encrypts in the unprefixed V1 format and round-trips", () => {
    const fc = createFieldCrypto({ keys: { 1: K1 } });
    const ct = fc.encrypt("+919876543210");
    expect(ct.startsWith("k")).toBe(false);
    expect(fc.versionOf(ct)).toBe(1);
    expect(fc.decrypt(ct)).toBe("+919876543210");
    expect(fc.activeVersion).toBe(1);
  });

  it("decrypts ciphertext produced by the V1 apps/api helper", () => {
    const fc = createFieldCrypto({ keys: { 1: K1 } });
    expect(fc.decrypt(legacyEncrypt("hello", K1))).toBe("hello");
  });

  it("active version defaults to the highest key and prefixes new ciphertexts", () => {
    const fc = createFieldCrypto({ keys: { 1: K1, 2: K2 } });
    const ct = fc.encrypt("x");
    expect(ct.startsWith("k2:")).toBe(true);
    expect(fc.activeVersion).toBe(2);
    expect(fc.decrypt(ct)).toBe("x");
  });

  it("still decrypts older versions after rotation and flags them stale", () => {
    const old = createFieldCrypto({ keys: { 1: K1 } });
    const legacyCt = old.encrypt("legacy");
    const fc = createFieldCrypto({ keys: { 1: K1, 2: K2, 3: K3 } });
    expect(fc.decrypt(legacyCt)).toBe("legacy");
    expect(fc.isStale(legacyCt)).toBe(true);
    const v2 = createFieldCrypto({ keys: { 1: K1, 2: K2 } }).encrypt("two");
    expect(fc.decrypt(v2)).toBe("two");
    expect(fc.isStale(v2)).toBe(true);
    const rotated = fc.rotate(v2);
    expect(rotated.startsWith("k3:")).toBe(true);
    expect(fc.isStale(rotated)).toBe(false);
    expect(fc.rotate(rotated)).toBe(rotated); // already current → untouched
    expect(fc.decrypt(rotated)).toBe("two");
  });

  it("honours an explicit active version lower than the highest (dual-accept window)", () => {
    const fc = createFieldCrypto({ keys: { 1: K1, 2: K2 }, activeVersion: 1 });
    expect(fc.encrypt("a").startsWith("k")).toBe(false);
    expect(fc.decrypt(createFieldCrypto({ keys: { 2: K2 } }).encrypt("b"))).toBe("b");
  });

  it("fails closed on an unknown version, a tampered tag, and an empty keyring", () => {
    const fc = createFieldCrypto({ keys: { 1: K1 } });
    const foreign = createFieldCrypto({ keys: { 1: K1, 9: K3 } }).encrypt("z");
    expect(() => fc.decrypt(foreign)).toThrow(FieldCryptoError);
    const ct = fc.encrypt("tamper");
    const buf = Buffer.from(ct, "base64");
    buf[12] ^= 0xff;
    expect(() => fc.decrypt(buf.toString("base64"))).toThrow();
    expect(() => fc.decrypt("AAAA")).toThrow(FieldCryptoError);
    expect(() => createFieldCrypto({ keys: {} })).toThrow(FieldCryptoError);
    expect(() => createFieldCrypto({ keys: { 1: K1 }, activeVersion: 4 })).toThrow(FieldCryptoError);
  });

  it("keyringFromEnv parses the environment convention", () => {
    const opts = keyringFromEnv({ FIELD_ENCRYPTION_KEY: K1, FIELD_ENCRYPTION_KEYS: `2:${K2}, 3:${K3}`, FIELD_ENCRYPTION_ACTIVE_KEY_VERSION: "2" });
    expect(Object.keys(opts.keys).map(Number)).toEqual([1, 2, 3]);
    expect(opts.activeVersion).toBe(2);
    expect(keyringFromEnv({ FIELD_ENCRYPTION_KEY: K1 }).activeVersion).toBeUndefined();
    expect(() => keyringFromEnv({ FIELD_ENCRYPTION_KEY: K1, FIELD_ENCRYPTION_KEYS: "1:tooshort" })).toThrow(FieldCryptoError);
    expect(() => keyringFromEnv({ FIELD_ENCRYPTION_KEY: K1, FIELD_ENCRYPTION_KEYS: "x:" + K2 })).toThrow(FieldCryptoError);
  });

  it("ciphertexts are non-deterministic (fresh IV every time)", () => {
    const fc = createFieldCrypto({ keys: { 1: K1 } });
    expect(fc.encrypt("same")).not.toBe(fc.encrypt("same"));
  });
});

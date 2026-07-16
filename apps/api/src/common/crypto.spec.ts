import { decryptField, encryptField, hashOtp, phoneDigest, verifyOtp } from "./crypto";

describe("crypto", () => {
  it("hashes and verifies OTPs without storing plaintext", () => {
    const stored = hashOtp("123456");
    expect(stored).not.toContain("123456");
    expect(verifyOtp("123456", stored)).toBe(true);
    expect(verifyOtp("654321", stored)).toBe(false);
    expect(verifyOtp("123456", "garbage")).toBe(false);
  });

  it("produces deterministic phone digests and reversible field encryption", () => {
    expect(phoneDigest("+919000000001")).toBe(phoneDigest("+919000000001"));
    expect(phoneDigest("+919000000001")).not.toBe(phoneDigest("+919000000002"));

    const ct = encryptField("+919000000001");
    expect(ct).not.toContain("9000000001");
    expect(decryptField(ct)).toBe("+919000000001");
    // Non-deterministic ciphertext (random IV).
    expect(encryptField("+919000000001")).not.toBe(ct);
  });
});

import * as OTPAuth from "otpauth";

/**
 * TOTP for admin MFA (docs/18) — via `otpauth` rather than hand-rolled
 * node:crypto, unlike this codebase's other primitives (hashing, AES-GCM,
 * Ed25519 verification). The HOTP counter/truncation algorithm plus base32
 * encode/decode is fiddly enough to get subtly wrong that a small, focused,
 * well-maintained library is the safer choice for something MFA-critical.
 * SHA1 (the RFC 6238 default) is required, not a downgrade: every mainstream
 * authenticator app (Google/Microsoft/Authy) only supports SHA1, and TOTP's
 * use of SHA1 as an HMAC primitive is unaffected by SHA1's collision
 * weaknesses (those only matter for hash-then-compare use cases).
 */
const ISSUER = "medpass admin";

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function totpUri(secretBase32: string, email: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  return totp.toString();
}

/** ±1 step (30s) tolerance for clock drift, matching RFC 6238's own recommendation. */
export function verifyTotpCode(secretBase32: string, code: string): boolean {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  return totp.validate({ token: code, window: 1 }) !== null;
}

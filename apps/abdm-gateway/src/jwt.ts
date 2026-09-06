import { createHmac, createPublicKey, timingSafeEqual, verify as verifySignature, type KeyObject } from "node:crypto";

/**
 * Gateway JWT verification for inbound ABDM callbacks (docs_v2/08 §4: "every inbound callback is
 * verified (gateway JWT)"). Deliberately dependency-free: the token is a compact JWS; HS256 covers
 * the mock and early sandbox, RS256 is what the gateway publishes for production — the algorithm
 * is chosen by the *verifier configured*, never by the token's own `alg` claim (no alg confusion).
 */

export interface GatewayJwtClaims {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
  [claim: string]: unknown;
}

export interface GatewayJwtVerifier {
  readonly algorithm: "HS256" | "RS256";
  verify(token: string, now?: number): GatewayJwtClaims;
}

export class GatewayJwtError extends Error {
  override readonly name = "GatewayJwtError";
  constructor(
    readonly reason: "malformed" | "algorithm" | "signature" | "expired" | "not_yet_valid" | "issuer" | "audience",
    message: string,
  ) {
    super(message);
  }
}

export interface ClaimExpectations {
  issuer?: string;
  audience?: string;
  /** Seconds of clock skew tolerated on exp/nbf. */
  leewaySeconds?: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function decodeSegment(segment: string, what: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new GatewayJwtError("malformed", `JWT ${what} is not valid base64url JSON`);
  }
}

function checkClaims(claims: GatewayJwtClaims, expect: ClaimExpectations, now: number): void {
  const leeway = expect.leewaySeconds ?? 60;
  const seconds = Math.floor(now / 1000);
  if (typeof claims.exp === "number" && seconds > claims.exp + leeway) throw new GatewayJwtError("expired", "JWT has expired");
  if (typeof claims.nbf === "number" && seconds + leeway < claims.nbf) throw new GatewayJwtError("not_yet_valid", "JWT is not yet valid");
  if (expect.issuer && claims.iss !== expect.issuer) throw new GatewayJwtError("issuer", "JWT issuer mismatch");
  if (expect.audience) {
    const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
    if (!aud.includes(expect.audience)) throw new GatewayJwtError("audience", "JWT audience mismatch");
  }
}

function splitToken(token: string): { header: Record<string, unknown>; payload: Record<string, unknown>; signingInput: string; signature: Buffer } {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) throw new GatewayJwtError("malformed", "JWT must have three segments");
  const [h, p, s] = parts as [string, string, string];
  return { header: decodeSegment(h, "header"), payload: decodeSegment(p, "payload"), signingInput: `${h}.${p}`, signature: Buffer.from(s, "base64url") };
}

/** HS256 (shared secret) — the mock gateway and the sandbox's early integration profile. */
export class Hs256Verifier implements GatewayJwtVerifier {
  readonly algorithm = "HS256" as const;
  constructor(
    private readonly secret: string,
    private readonly expect: ClaimExpectations = {},
  ) {}

  verify(token: string, now = Date.now()): GatewayJwtClaims {
    const { header, payload, signingInput, signature } = splitToken(token);
    if (header["alg"] !== "HS256") throw new GatewayJwtError("algorithm", `expected HS256, token says ${String(header["alg"])}`);
    const expected = createHmac("sha256", this.secret).update(signingInput).digest();
    if (expected.length !== signature.length || !timingSafeEqual(expected, signature)) throw new GatewayJwtError("signature", "JWT signature does not verify");
    checkClaims(payload, this.expect, now);
    return payload;
  }
}

/** RS256 (gateway public key, PEM) — pluggable for sandbox/production once NHA publishes the key. */
export class Rs256Verifier implements GatewayJwtVerifier {
  readonly algorithm = "RS256" as const;
  private readonly key: KeyObject;
  constructor(publicKeyPem: string, private readonly expect: ClaimExpectations = {}) {
    this.key = createPublicKey(publicKeyPem);
  }

  verify(token: string, now = Date.now()): GatewayJwtClaims {
    const { header, payload, signingInput, signature } = splitToken(token);
    if (header["alg"] !== "RS256") throw new GatewayJwtError("algorithm", `expected RS256, token says ${String(header["alg"])}`);
    if (!verifySignature("sha256", Buffer.from(signingInput), this.key, signature)) throw new GatewayJwtError("signature", "JWT signature does not verify");
    checkClaims(payload, this.expect, now);
    return payload;
  }
}

/** Test/mock helper: mint an HS256 token the way the mock gateway does. Never used on a real callback path. */
export function signHs256(claims: GatewayJwtClaims, secret: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/** Picks the verifier from configuration: RS256 wins when a public key is set, else HS256. */
export function verifierFromConfig(config: { hs256Secret?: string; rs256PublicKeyPem?: string; issuer?: string; audience?: string }): GatewayJwtVerifier {
  const expect: ClaimExpectations = { issuer: config.issuer, audience: config.audience };
  if (config.rs256PublicKeyPem) return new Rs256Verifier(config.rs256PublicKeyPem, expect);
  if (config.hs256Secret) return new Hs256Verifier(config.hs256Secret, expect);
  throw new Error("no gateway JWT verifier configured");
}

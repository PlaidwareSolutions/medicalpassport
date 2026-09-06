import { generateKeyPairSync, sign } from "node:crypto";
import { GatewayJwtError, Hs256Verifier, Rs256Verifier, signHs256, verifierFromConfig } from "./jwt";

const SECRET = "unit-test-gateway-secret-not-secret";
const now = Date.UTC(2026, 8, 6, 12, 0, 0);
const seconds = Math.floor(now / 1000);

function rs256Token(claims: Record<string, unknown>, privateKey: string, alg = "RS256"): string {
  const b64 = (s: string) => Buffer.from(s).toString("base64url");
  const input = `${b64(JSON.stringify({ alg, typ: "JWT" }))}.${b64(JSON.stringify(claims))}`;
  const signature = sign("sha256", Buffer.from(input), privateKey).toString("base64url");
  return `${input}.${signature}`;
}

describe("gateway JWT verification", () => {
  describe("HS256 (mock / early sandbox)", () => {
    const verifier = new Hs256Verifier(SECRET, { issuer: "abdm-gateway", audience: "medicinepassport" });
    const claims = { iss: "abdm-gateway", aud: "medicinepassport", sub: "hiu", iat: seconds, exp: seconds + 300 };

    it("accepts a well-formed token and returns its claims", () => {
      expect(verifier.verify(signHs256(claims, SECRET), now)).toEqual(claims);
      expect(verifier.algorithm).toBe("HS256");
    });

    it.each([
      ["wrong secret", (): string => signHs256(claims, "another-secret-entirely-not-this-one"), "signature"],
      ["expired", (): string => signHs256({ ...claims, exp: seconds - 3600 }, SECRET), "expired"],
      ["not yet valid", (): string => signHs256({ ...claims, nbf: seconds + 3600 }, SECRET), "not_yet_valid"],
      ["issuer mismatch", (): string => signHs256({ ...claims, iss: "someone-else" }, SECRET), "issuer"],
      ["audience mismatch", (): string => signHs256({ ...claims, aud: ["other"] }, SECRET), "audience"],
      ["two segments", (): string => "abc.def", "malformed"],
      ["garbage payload", (): string => `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.!!!.sig`, "malformed"],
    ] as const)("rejects %s", (_label, make, reason) => {
      let caught: unknown;
      try {
        verifier.verify(make(), now);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(GatewayJwtError);
      expect((caught as GatewayJwtError).reason).toBe(reason);
    });

    it("never lets the token pick the algorithm (alg=none / RS256 are refused by an HS256 verifier)", () => {
      const b64 = (s: string) => Buffer.from(s).toString("base64url");
      const none = `${b64(JSON.stringify({ alg: "none" }))}.${b64(JSON.stringify(claims))}.`;
      expect(() => verifier.verify(none, now)).toThrow(GatewayJwtError);
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
      expect(() => verifier.verify(rs256Token(claims, privateKey), now)).toThrow(/expected HS256/);
    });

    it("tolerates 60s of clock skew on exp", () => {
      expect(() => verifier.verify(signHs256({ ...claims, exp: seconds - 30 }, SECRET), now)).not.toThrow();
    });
  });

  describe("RS256 (pluggable for the gateway's published key)", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    const other = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    const claims = { iss: "gateway", sub: "hip", exp: seconds + 60 };

    it("verifies a token signed by the matching private key and refuses another key", () => {
      const verifier = new Rs256Verifier(publicKey, { issuer: "gateway" });
      expect(verifier.verify(rs256Token(claims, privateKey), now)).toEqual(claims);
      expect(() => verifier.verify(rs256Token(claims, other.privateKey), now)).toThrow(/does not verify/);
      expect(() => verifier.verify(signHs256(claims, SECRET), now)).toThrow(/expected RS256/);
    });

    it("verifierFromConfig prefers RS256 when a public key is configured", () => {
      expect(verifierFromConfig({ hs256Secret: SECRET, rs256PublicKeyPem: publicKey }).algorithm).toBe("RS256");
      expect(verifierFromConfig({ hs256Secret: SECRET }).algorithm).toBe("HS256");
      expect(() => verifierFromConfig({})).toThrow(/no gateway JWT verifier/);
    });
  });
});

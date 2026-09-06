import { abdmGatewayEnvShape, loadEnv, type AbdmGatewayEnv } from "@medpass/config";

let cached: AbdmGatewayEnv | undefined;

/** Validated environment (docs_v2/08 §4). Fails fast: no ABDM credential ever has a silent default. */
export function env(): AbdmGatewayEnv {
  if (!cached) {
    cached = loadEnv(abdmGatewayEnvShape);
    if (cached.NODE_ENV === "production" && cached.MOCK) {
      throw new Error("MOCK=true replays fixtures and is refused in production");
    }
    if (!cached.MOCK && !cached.ABDM_GATEWAY_JWT_HS256_SECRET && !cached.ABDM_GATEWAY_JWT_RS256_PUBLIC_KEY) {
      throw new Error("Callback verification needs ABDM_GATEWAY_JWT_HS256_SECRET or ABDM_GATEWAY_JWT_RS256_PUBLIC_KEY unless MOCK=true");
    }
    if (!cached.MOCK && !cached.ABDM_BASE_URL) {
      throw new Error("ABDM_BASE_URL is required unless MOCK=true");
    }
  }
  return cached;
}

/** Test-only: reset the cache so specs can vary the environment. */
export function resetEnvCache(): void {
  cached = undefined;
}

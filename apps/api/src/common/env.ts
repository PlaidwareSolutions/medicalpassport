import { apiEnvShape, loadEnv, type ApiEnv } from "@medpass/config";

let cached: ApiEnv | undefined;

export function env(): ApiEnv {
  if (!cached) {
    cached = loadEnv(apiEnvShape);
    if (cached.NODE_ENV === "production" && cached.OTP_TRANSPORT === "log") {
      throw new Error("OTP_TRANSPORT=log is a development transport and is refused in production");
    }
    if (cached.NODE_ENV === "production" && cached.OTP_DEV_FIXED_CODE) {
      throw new Error("OTP_DEV_FIXED_CODE must not be set in production");
    }
  }
  return cached;
}

/** Test-only: reset the cache so specs can vary the environment. */
export function resetEnvCache(): void {
  cached = undefined;
}

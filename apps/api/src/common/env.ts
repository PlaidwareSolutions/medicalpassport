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
    if (cached.OTP_TRANSPORT === "sms" && (!cached.TELNYX_API_KEY || !cached.TELNYX_FROM_NUMBER)) {
      throw new Error("OTP_TRANSPORT=sms requires TELNYX_API_KEY and TELNYX_FROM_NUMBER");
    }
    if (cached.OTP_TRANSPORT === "voice" && (!cached.TELNYX_API_KEY || !cached.TELNYX_FROM_NUMBER || !cached.TELNYX_VOICE_CONNECTION_ID)) {
      throw new Error("OTP_TRANSPORT=voice requires TELNYX_API_KEY, TELNYX_FROM_NUMBER, and TELNYX_VOICE_CONNECTION_ID");
    }
    // A fixed code makes sense with the "log" dev transport (nothing is
    // actually sent); paired with a real transport it would text/speak a
    // guessable, unchanging code to whoever asks, at real per-message/call
    // cost, in any environment that isn't literally NODE_ENV=production
    // (e.g. a staging environment doing real user testing) — the guard
    // above only catches production.
    if ((cached.OTP_TRANSPORT === "sms" || cached.OTP_TRANSPORT === "voice") && cached.OTP_DEV_FIXED_CODE) {
      throw new Error(`OTP_DEV_FIXED_CODE must not be set alongside OTP_TRANSPORT=${cached.OTP_TRANSPORT}`);
    }
  }
  return cached;
}

/** Test-only: reset the cache so specs can vary the environment. */
export function resetEnvCache(): void {
  cached = undefined;
}

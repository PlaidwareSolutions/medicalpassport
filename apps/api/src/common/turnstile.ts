interface SiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
}

/**
 * Verifies a Cloudflare Turnstile token server-side (docs/26 §12.4). Skipped
 * entirely when no secret is configured (dev/local, where Turnstile isn't
 * provisioned) — the same optional-vendor pattern as Telnyx/VAPID/R2
 * elsewhere in this app, so local dev never needs a real Cloudflare
 * account. Takes the secret as a parameter rather than reading env()
 * itself, matching `verifyTelnyxWebhookSignature`'s convention — keeps this
 * a pure function the caller feeds credentials into.
 */
export async function verifyTurnstile(secret: string | undefined, token: string | undefined, remoteIp: string | undefined): Promise<boolean> {
  if (!secret) return true;
  if (!token) return false;

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token, ...(remoteIp ? { remoteip: remoteIp } : {}) }),
  });
  const json = (await res.json().catch(() => null)) as SiteverifyResponse | null;
  return json?.success === true;
}

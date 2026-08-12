interface SiteverifyResponse {
  success: boolean;
  hostname?: string;
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
 *
 * `expectedHostnames` (optional, defense-in-depth per Stage-7/Session-11):
 * when provided, the Siteverify `hostname` must be one of them — so a token
 * minted for some other site cannot authorize this endpoint. Cloudflare's
 * test secret returns no meaningful hostname, so the check is only applied
 * when the response actually carries a hostname; production sets the real
 * secret + the expected hostname together.
 */
export async function verifyTurnstile(
  secret: string | undefined,
  token: string | undefined,
  remoteIp: string | undefined,
  expectedHostnames?: string[],
): Promise<boolean> {
  if (!secret) return true;
  if (!token) return false;

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token, ...(remoteIp ? { remoteip: remoteIp } : {}) }),
  });
  const json = (await res.json().catch(() => null)) as SiteverifyResponse | null;
  if (json?.success !== true) return false;
  if (expectedHostnames?.length && json.hostname && !expectedHostnames.includes(json.hostname)) return false;
  return true;
}

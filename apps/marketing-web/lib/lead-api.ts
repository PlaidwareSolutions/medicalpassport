/**
 * Where the professional lead form POSTs (OD-LP-2). Env-driven so the staging
 * marketing build targets staging-api and production targets api. Defaults to
 * staging while the production apex does not yet exist.
 */
export const LEAD_API_URL =
  process.env.NEXT_PUBLIC_LEAD_API_URL ?? "https://staging-api.medidocs.app/v1/public/leads";

/** Public Turnstile sitekey for the lead widget; when unset the widget is not
 *  rendered and the form submits without a token (server skips verification —
 *  the optional-vendor pattern, matched on the API side). */
export const LEAD_TURNSTILE_SITEKEY = process.env.NEXT_PUBLIC_LEAD_TURNSTILE_SITEKEY ?? "";

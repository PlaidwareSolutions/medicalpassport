/**
 * First-party acquisition attribution (OD-LP-8, Session 11).
 *
 * The marketing CTA sends patients to `app.medidocs.app/?src=website`. This
 * captures that controlled value on first load and holds it client-side until
 * the patient establishes an account (OTP verify), where the API persists it
 * once (first-touch). Only the known `website` value is ever stored — never a
 * referrer, UTM string, phone number, or health data.
 */
const KEY = "medpass_acquisition_source";
const KNOWN = new Set(["website"]);

/** Read `?src=` on this load; store it as first-touch if we don't already
 *  have one. Safe to call on every page mount. */
export function captureAcquisitionSource(): void {
  if (typeof window === "undefined") return;
  try {
    if (localStorage.getItem(KEY)) return; // first-touch wins; never overwrite
    const src = new URLSearchParams(window.location.search).get("src");
    if (src && KNOWN.has(src)) localStorage.setItem(KEY, src);
  } catch {
    /* storage unavailable (private mode / blocked) — attribution is best-effort */
  }
}

/** The stored acquisition source, or undefined. Sent with OTP verify. */
export function getAcquisitionSource(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * What a scanned (or pasted) onboarding code turns into. The patient app
 * encodes the raw token; a future deep link may wrap it in a URL
 * (`…/onboard?token=…` or `…/onboard/<token>`), and a receptionist may paste
 * with whitespace around it. The API accepts 16–200 characters.
 */
const MIN = 16;
const MAX = 200;

export function extractOnboardingToken(raw: string): string | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  let candidate = text;
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const fromQuery = url.searchParams.get("token") ?? url.searchParams.get("qrToken");
      const fromPath = url.pathname.split("/").filter(Boolean).pop();
      candidate = (fromQuery ?? fromPath ?? "").trim();
    } catch {
      return undefined;
    }
  }
  if (candidate.length < MIN || candidate.length > MAX) return undefined;
  if (/\s/.test(candidate)) return undefined;
  return candidate;
}

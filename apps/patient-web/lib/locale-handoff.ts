import { isLocale, type Locale } from "@medpass/localization";

/**
 * Marketing → app locale handoff (Session 17; OD-LP-4 addendum / Session-13
 * deferred ruling). A localized marketing page can pass `?lang=<locale>` to
 * the app to initialize a new patient's language.
 *
 * Precedence:
 *   1. An existing explicit stored preference (`medpass_locale`) ALWAYS wins —
 *      clicking a marketing link never overrides a deliberate choice.
 *   2. Otherwise a valid `?lang=` hint (en|hi|te|ur) initializes the locale and
 *      is persisted, so a refresh / offline load keeps it.
 *   3. Otherwise the existing default (English).
 *
 * Anything not in the allowlist is ignored safely — `isLocale` is a strict
 * enum check over statically-imported dictionaries, so there is no throw, no
 * persistence, no dynamic import, and no path-traversal / arbitrary locale
 * state. This is deliberately independent of `?src=` acquisition attribution.
 */
export function pickInitialLocale(opts: {
  stored: string | null | undefined;
  langParam: string | null | undefined;
}): { locale: Locale; persist: boolean } {
  if (isLocale(opts.stored)) return { locale: opts.stored, persist: false };
  if (isLocale(opts.langParam)) return { locale: opts.langParam, persist: true };
  return { locale: "en", persist: false };
}

/** Reads the `lang` query param from a location search string (safe/no-throw). */
export function readLangParam(search: string): string | null {
  try {
    return new URLSearchParams(search).get("lang");
  } catch {
    return null;
  }
}

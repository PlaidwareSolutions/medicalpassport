import { RTL_LOCALES, SUPPORTED_LOCALES, type Locale } from "@medpass/domain";
import { en } from "./dictionaries/en.js";
import { hi } from "./dictionaries/hi.js";
import { te } from "./dictionaries/te.js";
import { ur } from "./dictionaries/ur.js";

export { SUPPORTED_LOCALES, RTL_LOCALES };
export type { Locale };

export type MessageKey = keyof typeof en;

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { en, hi, te, ur };

export function isLocale(v: string | undefined | null): v is Locale {
  return !!v && (SUPPORTED_LOCALES as readonly string[]).includes(v);
}

export function direction(locale: Locale): "ltr" | "rtl" {
  return RTL_LOCALES.includes(locale) ? "rtl" : "ltr";
}

/**
 * Resolves a message, falling back to English. Missing keys return the key
 * itself so gaps are visible in QA rather than silently blank.
 */
export function t(locale: Locale, key: MessageKey, params?: Record<string, string | number>): string {
  const template = DICTIONARIES[locale][key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

/**
 * Picks the singular or plural message key for a count.
 *
 * Machine pluralisation — "1 prescription(s)", "1 pages", "0 medicine(s)" —
 * is a developer's shorthand leaking onto a patient's screen, so every
 * counted string in these dictionaries has two keys: `<key>_one` for
 * exactly one, `<key>` for everything else (zero included).
 *
 * All four supported locales (en, hi, te, ur) distinguish only one from
 * many, so `count === 1` is the whole rule. A locale with dual or paucal
 * forms would need `Intl.PluralRules` and a key per category — the two-key
 * shape here is deliberately the simplest thing that is correct for the
 * languages actually shipped, not a general plural engine.
 */
export function pluralKey<K extends MessageKey>(count: number, one: K, other: K): K {
  return count === 1 ? one : other;
}

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  hi: "हिन्दी",
  te: "తెలుగు",
  ur: "اردو",
};

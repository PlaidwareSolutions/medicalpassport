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

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  hi: "हिन्दी",
  te: "తెలుగు",
  ur: "اردو",
};

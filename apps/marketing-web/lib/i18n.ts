import { en } from "./dictionaries/en";
import { hi } from "./dictionaries/hi";
import { te } from "./dictionaries/te";
import { ur } from "./dictionaries/ur";
import type { MarketingLocale } from "./locales";

export type MessageKey = keyof typeof en;

/**
 * Marketing dictionaries. English is the canonical source. hi/te/ur are Session
 * 13 candidate translations, status DRAFT — PROFESSIONAL REVIEW REQUIRED. Their
 * presence here does NOT publish them: the publication gate is the emitted route
 * set (see buildLocales() in ./locales) — production emits only PUBLISHED_LOCALES,
 * staging additionally emits the drafts (noindexed) for review. `t()` falls back
 * to English for any missing key (e.g. the clinics and lead strings are
 * intentionally English on the English-only /for-clinics/ route).
 */
const dictionaries: Partial<Record<MarketingLocale, Record<MessageKey, string>>> = {
  en,
  hi,
  te,
  ur,
};

export function t(locale: MarketingLocale, key: MessageKey): string {
  return dictionaries[locale]?.[key] ?? en[key];
}

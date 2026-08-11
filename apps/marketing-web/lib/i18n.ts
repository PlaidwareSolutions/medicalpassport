import { en } from "./dictionaries/en";
import type { MarketingLocale } from "./locales";

export type MessageKey = keyof typeof en;

/**
 * Reviewed dictionaries only (OD-LP-4): a locale appears here after its
 * marketing translations pass professional review, alongside its addition to
 * PUBLISHED_LOCALES. English fallback mirrors packages/localization.
 */
const dictionaries: Partial<Record<MarketingLocale, Record<MessageKey, string>>> = {
  en,
};

export function t(locale: MarketingLocale, key: MessageKey): string {
  return dictionaries[locale]?.[key] ?? en[key];
}

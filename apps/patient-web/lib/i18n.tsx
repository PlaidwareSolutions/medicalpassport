"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { direction, t as translate, type Locale, type MessageKey } from "@medpass/localization";
import { pickInitialLocale, readLangParam } from "./locale-handoff";

const LOCALE_STORAGE_KEY = "medpass_locale";

interface I18n {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18n>({
  locale: "en",
  setLocale: () => {},
  t: (key) => translate("en", key),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    // Precedence (Session 17): an explicit stored preference wins; otherwise a
    // valid marketing ?lang= hint initializes and persists; otherwise English.
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      /* storage blocked (private mode) — fall back to the hint/default */
    }
    const langParam = readLangParam(window.location.search);
    const { locale: initial, persist } = pickInitialLocale({ stored, langParam });
    setLocaleState(initial);
    if (persist) {
      try {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, initial);
      } catch {
        /* best-effort persistence */
      }
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction(locale);
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, l);
  }, []);

  const value = useMemo<I18n>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}

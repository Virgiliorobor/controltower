// i18n React context. Spanish default; persists the chosen locale in localStorage (a UI preference, NOT a
// session token — that distinction matters for the security baseline). Builder C wraps views in <I18nProvider>
// and reads `useI18n()` for the active locale + translate function + a toggle.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_LOCALE, translate, type Locale } from './strings';

interface I18nValue {
  locale: Locale;
  t: (key: string) => string;
  setLocale: (locale: Locale) => void;
  toggle: () => void;
}

const STORAGE_KEY = 'cct.locale';

const I18nContext = createContext<I18nValue | null>(null);

function initialLocale(): Locale {
  const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
  return stored === 'en' ? 'en' : DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
      document.documentElement.lang = next;
    }
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      t: (key: string) => translate(locale, key),
      setLocale,
      toggle: () => setLocale(locale === 'es' ? 'en' : 'es'),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return ctx;
}

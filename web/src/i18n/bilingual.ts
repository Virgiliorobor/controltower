// Bilingual field resolution (DC-5 / DC-6 / D0-5): never blank. When EN is requested but missing, show the ES
// value tagged "ES"; when only EN exists, show it. Returns { text, esFallback } so the view can render the
// small "ES" chip beside an ES-only value in EN mode (a prompt for editors to fill the gloss).

import type { Locale } from './strings';

export interface Resolved {
  text: string | null;
  esFallback: boolean; // true → the EN value was missing and we fell back to the ES value (render an "ES" tag)
  empty: boolean; // true → neither ES nor EN present (render an explicit gap, never a blank)
}

export function resolveBilingual(
  locale: Locale,
  es: string | null | undefined,
  en: string | null | undefined,
): Resolved {
  const esVal = es?.trim() ? es : null;
  const enVal = en?.trim() ? en : null;
  if (locale === 'es') {
    if (esVal) return { text: esVal, esFallback: false, empty: false };
    if (enVal) return { text: enVal, esFallback: false, empty: false };
    return { text: null, esFallback: false, empty: true };
  }
  // EN requested
  if (enVal) return { text: enVal, esFallback: false, empty: false };
  if (esVal) return { text: esVal, esFallback: true, empty: false };
  return { text: null, esFallback: false, empty: true };
}

// Pick a plain string with ES-first fallback (no tag info) — for titles in lists where the tag is overkill.
export function pickBilingual(
  locale: Locale,
  es: string | null | undefined,
  en: string | null | undefined,
): string {
  return resolveBilingual(locale, es, en).text ?? '';
}

// Format a date for display in the active locale (DC-6: MX locale by default).
export function formatDate(locale: Locale, iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(locale === 'es' ? 'es-MX' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

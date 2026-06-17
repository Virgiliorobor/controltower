// VIEW 13 — Auth / Login (Acceso). Doc-surface light sheet (visual_spec Per-View: a login is a document moment,
// deliberately NOT the dark board). email+password → POST /api/v1/auth/login. Shows the role after login, then
// routes to the user's map/library. ES|EN toggle present pre-auth (FLOW 6). Handles invalid/no-access states.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { ApiRequestError } from '../lib/api';
import { Field, PrimaryButton, TextInput } from '../components/primitives';

export default function LoginView(): JSX.Element {
  const { t, locale, setLocale } = useI18n();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim().toLowerCase(), password);
      navigate('/');
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 403) setError(t('auth.noAccess'));
      else setError(t('auth.invalid'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-doc-bg">
      <header className="flex h-12 items-center justify-between border-b border-board-line bg-board-panel px-4">
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-4 w-[2px] bg-accent" />
          <span className="text-sm font-medium tracking-label text-ink-onboard">{t('app.title')}</span>
        </div>
        <div className="inline-flex overflow-hidden rounded-sm border border-board-line text-2xs uppercase tracking-label">
          {(['es', 'en'] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLocale(l)}
              aria-pressed={locale === l}
              className={`px-2 py-1 ${locale === l ? 'bg-accent text-white' : 'text-ink-onboard-muted hover:bg-board-hover'}`}
            >
              {l}
            </button>
          ))}
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center p-4">
        <form
          onSubmit={onSubmit}
          className="w-full max-w-sm rounded-sm border border-doc-line bg-doc-surface p-6 text-ink"
        >
          <h1 className="text-xl font-semibold">{t('auth.welcome')}</h1>
          <p className="mt-1 text-sm leading-wiki text-ink-muted">{t('app.tagline')}</p>

          <div className="mt-6 space-y-4">
            <Field label={t('auth.email')} required>
              <TextInput
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label={t('auth.password')} required>
              <TextInput
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
          </div>

          {error && (
            <div className="mt-4 rounded-sm border border-status-red bg-status-red/5 px-3 py-2 text-sm text-status-red-doc">
              {error}
            </div>
          )}

          <div className="mt-6">
            <PrimaryButton type="submit" disabled={submitting} className="w-full">
              {submitting ? t('auth.signingIn') : t('auth.submit')}
            </PrimaryButton>
          </div>
        </form>
      </main>
    </div>
  );
}

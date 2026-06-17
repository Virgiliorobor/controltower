// App shell (VIEW 2 chrome / IA §2): the always-present top bar + role-aware nav. The cyan calibration-tick
// brand mark, the process selector (name + status word + step count + rolled-up RAG glyph), ES|EN toggle
// (persisted via i18n), the user/role menu. Role chrome (D0-7 / DC-8): VIEWER never sees authoring nav
// (Create is implied by the library "+ Nuevo"); ADMIN additionally sees Users/Settings. Nav links are OMITTED
// for roles that lack them, never disabled.

import { useState } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { useProcesses, useProcessMap } from '../lib/hooks';
import { pickBilingual } from '../i18n/bilingual';
import { rollupRag } from '../lib/endpoints';
import { StatusGlyph } from './channels';

function BrandTick(): JSX.Element {
  // The signature: a single cyan calibration tick (a gauge's zero mark) before the tenant name (visual_spec §4).
  return <span aria-hidden className="inline-block h-4 w-[2px] bg-accent" />;
}

function LanguageToggle(): JSX.Element {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="inline-flex overflow-hidden rounded-sm border border-board-line text-2xs uppercase tracking-label" aria-label={t('lang.toggle')}>
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
  );
}

function ProcessSelector(): JSX.Element | null {
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const { processId } = useParams();
  const { isEditor } = useAuth();
  // Editors see drafts too; viewers only see active/archived (the API already filters viewers via RLS, but we
  // also avoid showing a draft selector option that a viewer cannot open).
  const { data: processes } = useProcesses(isEditor ? {} : { status: 'active' });
  const { data: graph } = useProcessMap(processId);

  if (!processes) return null;
  const rollup = graph ? rollupRag(graph.nodes) : 'unknown';

  return (
    <div className="flex items-center gap-2">
      <StatusGlyph status={rollup} size={12} />
      <select
        value={processId ?? ''}
        onChange={(e) => navigate(`/process/${e.target.value}`)}
        className="max-w-[280px] truncate rounded-sm border border-board-line bg-board-raised px-2 py-1 text-sm text-ink-onboard outline-none focus:border-accent focus:ring-2 focus:ring-accent"
        aria-label={t('nav.map')}
      >
        <option value="" disabled>
          {t('nav.library')}…
        </option>
        {processes.map((p) => (
          <option key={p.id} value={p.id}>
            {pickBilingual(locale, p.title_es, p.title_en)} · {t(`pstatus.${p.status}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TopBar(): JSX.Element {
  const { t } = useI18n();
  const { user, role, isEditor, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const navItem = (to: string, label: string) => (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `border-b-2 px-1 py-1 text-sm transition-colors ${
          isActive ? 'border-accent text-ink-onboard' : 'border-transparent text-ink-onboard-muted hover:text-ink-onboard'
        }`
      }
    >
      {label}
    </NavLink>
  );

  return (
    <header className="flex h-12 items-center justify-between gap-4 border-b border-board-line bg-board-panel px-4">
      <div className="flex items-center gap-4">
        <Link to="/" className="flex items-center gap-2">
          <BrandTick />
          <span className="text-sm font-medium tracking-label text-ink-onboard">{t('app.title')}</span>
        </Link>
        <ProcessSelector />
      </div>

      <nav className="flex items-center gap-4">
        {navItem('/', t('nav.library'))}
        {navItem('/contacts', t('nav.contacts'))}
        {/* Freshness is editor/admin to act; viewers read flags as status inside the step detail (D0-7). */}
        {isEditor && navItem('/freshness', t('nav.freshness'))}
        {isAdmin && navItem('/admin', t('nav.admin'))}
      </nav>

      <div className="flex items-center gap-3">
        <LanguageToggle />
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-sm border border-board-line px-2 py-1 text-2xs text-ink-onboard-muted hover:bg-board-hover"
          >
            <span className="max-w-[140px] truncate text-ink-onboard">{user?.email}</span>
            <span className="uppercase tracking-label">{role ? t(`role.${role}`) : ''}</span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-40 mt-1 w-44 rounded-sm border border-board-line bg-board-panel py-1">
              <button
                type="button"
                onClick={async () => {
                  setMenuOpen(false);
                  await logout();
                  navigate('/login');
                }}
                className="block w-full px-3 py-2 text-left text-sm text-ink-onboard hover:bg-board-hover"
              >
                {t('auth.logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

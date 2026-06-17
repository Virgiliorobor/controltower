// Map legend (DC-2 mandatory). Shows the full status triad (color+shape+word), the four edge kinds with their
// exact styles, the confidence keys (solid/dashed texture), and the CRITICAL key (spine bar). Collapsible.

import { useState } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import { StatusStamp } from '../channels';
import type { RagStatus } from '../../lib/types';

function EdgeSwatch({ kind }: { kind: 'sequential' | 'branch' | 'loop' | 'parallel' }): JSX.Element {
  return (
    <svg width="36" height="14" viewBox="0 0 36 14" aria-hidden>
      {kind === 'sequential' && <line x1="2" y1="7" x2="34" y2="7" stroke="#3A4A55" strokeWidth="1.5" markerEnd="" />}
      {kind === 'branch' && (
        <>
          <path d="M2,7 C14,7 18,2 34,2" stroke="#3A4A55" strokeWidth="1.5" fill="none" />
          <path d="M2,7 C14,7 18,12 34,12" stroke="#3A4A55" strokeWidth="1.5" fill="none" />
        </>
      )}
      {kind === 'loop' && <path d="M30,11 C30,1 6,1 6,11" stroke="#8B9AA6" strokeWidth="1.5" strokeDasharray="5 4" fill="none" />}
      {kind === 'parallel' && (
        <>
          <line x1="2" y1="5" x2="34" y2="5" stroke="#3A4A55" strokeWidth="1" />
          <line x1="2" y1="9" x2="34" y2="9" stroke="#3A4A55" strokeWidth="1" />
        </>
      )}
    </svg>
  );
}

export function Legend(): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const statuses: RagStatus[] = ['green', 'amber', 'red', 'unknown'];

  return (
    <div className="rounded-sm border border-board-line bg-board-panel text-2xs text-ink-onboard">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 uppercase tracking-label text-ink-onboard-muted"
      >
        {t('map.legend')}
        <span aria-hidden>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-board-line px-3 py-3">
          <div>
            <div className="mb-1 uppercase tracking-label text-ink-onboard-muted">{t('map.legend.health')}</div>
            <div className="flex flex-wrap gap-1">
              {statuses.map((s) => (
                <StatusStamp key={s} status={s} surface="board" />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 uppercase tracking-label text-ink-onboard-muted">{t('map.legend.confidence')}</div>
            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-3 w-6 border-2 border-solid border-ink-onboard-muted" />
                {t('confidence.confirmed')}
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-3 w-6 border-2 border-dashed border-ink-onboard-muted opacity-80" />
                {t('confidence.inferred')} / {t('confidence.flagged')}
              </span>
            </div>
          </div>

          <div>
            <div className="mb-1 uppercase tracking-label text-ink-onboard-muted">{t('map.legend.critical')}</div>
            <span className="inline-flex items-center gap-2">
              <span className="inline-block h-3 w-[3px] bg-accent-press" />
              {t('map.criticalDesc')}
            </span>
          </div>

          <div>
            <div className="mb-1 uppercase tracking-label text-ink-onboard-muted">{t('map.legend.edges')}</div>
            <div className="flex flex-col gap-1">
              {(['sequential', 'branch', 'loop', 'parallel'] as const).map((k) => (
                <span key={k} className="inline-flex items-center gap-2">
                  <EdgeSwatch kind={k} />
                  {t(`map.edge.${k}`)}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

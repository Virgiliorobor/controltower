// VIEW 11 — Freshness overview (Vigencia). Editor/Admin (act on flags); the freshness layer is suggestion-only
// (DC-4): flags NEVER auto-apply. A process is chosen via a selector; the latest report (GET .../freshness) is
// rolled up by severity + kind, each bilingual, each linking to the step in the map detail panel, each with an
// action hint. "Analizar vigencia" runs a scan (POST .../freshness-scan) — the only freshness AI loading state.
// Severities reuse the status triad glyphs (genuinely health-adjacent — visual_spec Per-View 10/11/12).

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { useFreshness, useProcesses, useInvalidators, errorMessage } from '../lib/hooks';
import { aiApi } from '../lib/endpoints';
import { pickBilingual } from '../i18n/bilingual';
import { StatusGlyph } from '../components/channels';
import { EmptyState, ErrorStrip, GhostButton, LoadingLine, PrimaryButton, ProgressBar, Tag } from '../components/primitives';
import type { FreshnessSeverity, RagStatus } from '../lib/types';

const SEV_TO_RAG: Record<FreshnessSeverity, RagStatus> = { high: 'red', medium: 'amber', low: 'unknown' };

export default function FreshnessView(): JSX.Element {
  const { t, locale } = useI18n();
  const { isEditor } = useAuth();
  const navigate = useNavigate();
  const { invalidateAll } = useInvalidators();
  const { data: processes } = useProcesses(isEditor ? {} : { status: 'active' });
  const [processId, setProcessId] = useState('');
  const { data: report, isLoading, isError, error, refetch } = useFreshness(processId || undefined);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  async function scan(): Promise<void> {
    if (!processId) return;
    setScanError(null);
    setScanning(true);
    try {
      await aiApi.freshnessScan(processId);
      invalidateAll();
      void refetch();
    } catch (err) {
      setScanError(errorMessage(err, t('freshness.error')));
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-ink-onboard">{t('freshness.title')}</h1>
        <div className="flex items-center gap-2">
          <select
            value={processId}
            onChange={(e) => setProcessId(e.target.value)}
            className="rounded-sm border border-board-line bg-board-raised px-2 py-1 text-sm text-ink-onboard"
          >
            <option value="">{t('nav.library')}…</option>
            {(processes ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {pickBilingual(locale, p.title_es, p.title_en)}
              </option>
            ))}
          </select>
          {processId && (
            <PrimaryButton onClick={() => void scan()} disabled={scanning} className="py-1 text-2xs">
              {scanning ? t('freshness.scanning') : t('freshness.scan')}
            </PrimaryButton>
          )}
        </div>
      </div>

      {scanning && <div className="mb-3"><ProgressBar label={t('freshness.scanning')} /></div>}
      {scanError && <ErrorStrip message={scanError} surface="board" onRetry={() => void scan()} />}

      {!processId && <EmptyState surface="board" message={t('freshness.noReport')} />}

      {processId && isLoading && <LoadingLine surface="board" />}
      {processId && isError && <ErrorStrip message={errorMessage(error, t('freshness.error'))} surface="board" onRetry={() => void refetch()} />}

      {processId && !isLoading && report === null && (
        <EmptyState
          surface="board"
          message={t('freshness.noReport')}
          action={isEditor ? <PrimaryButton onClick={() => void scan()}>{t('freshness.scan')}</PrimaryButton> : undefined}
        />
      )}

      {report && report.flags.length === 0 && (
        <div className="flex items-center gap-2 rounded-sm border border-status-green/40 bg-status-green/5 px-4 py-3 text-sm text-status-green">
          <StatusGlyph status="green" surface="board" /> {t('freshness.empty')}
        </div>
      )}

      {report && report.flags.length > 0 && (
        <>
          {(report.summary_es || report.summary_en) && (
            <div className="mb-3 rounded-sm border border-board-line bg-board-panel px-4 py-2 text-sm text-ink-onboard-muted">
              <span className="uppercase tracking-label">{t('freshness.summary')}: </span>
              {locale === 'es' ? report.summary_es : report.summary_en || report.summary_es}
            </div>
          )}
          <table className="w-full border-collapse text-sm text-ink-onboard">
            <thead>
              <tr className="border-b border-board-line text-left text-2xs uppercase tracking-label text-ink-onboard-muted">
                <th className="py-2 pr-3 font-medium">{t('freshness.col.severity')}</th>
                <th className="py-2 pr-3 font-medium">{t('freshness.col.kind')}</th>
                <th className="py-2 pr-3 font-medium">{t('freshness.col.detail')}</th>
                {isEditor && <th className="py-2 font-medium" />}
              </tr>
            </thead>
            <tbody>
              {report.flags.map((f, i) => (
                <tr key={i} className="border-b border-board-line align-top hover:bg-board-hover">
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-1">
                      <StatusGlyph status={SEV_TO_RAG[f.severity]} surface="board" size={12} />
                      {t(`sev.${f.severity}`)}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <Tag surface="board">{t(`fresh.${f.kind}`)}</Tag>
                  </td>
                  <td className="py-2 pr-3 leading-board text-ink-onboard-muted">
                    {locale === 'es' ? f.detail_es : f.detail_en || f.detail_es}
                  </td>
                  {isEditor && (
                    <td className="py-2 text-right">
                      {f.step_id && (
                        <GhostButton
                          surface="board"
                          className="py-1 text-2xs"
                          onClick={() => navigate(`/process/${processId}?step=${f.step_id}`)}
                        >
                          {t('freshness.act')}
                        </GhostButton>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-2xs italic text-ink-onboard-muted">{t('freshness.suggestionOnly')}</p>
        </>
      )}
    </div>
  );
}

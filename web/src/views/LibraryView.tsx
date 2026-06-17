// VIEW 1 — Process Library (Biblioteca de Procesos). Board-surface ruled table (no card wrappers, hairline rows
// — visual_spec §3 Tables). Each row: title (ES + EN gloss), status word, step count, rolled-up RAG glyph+word,
// owner or "sin dueño único", last-reviewed-ish. Editors/Admin get "+ Nuevo proceso" (→ Create chooser).
// Viewers get a read-only list (no New/Archive). Empty/loading/error states per design_spec.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { useProcesses, useProcessMap, useInvalidators, errorMessage } from '../lib/hooks';
import { pickBilingual } from '../i18n/bilingual';
import { rollupRag, processApi } from '../lib/endpoints';
import { StatusGlyph } from '../components/channels';
import {
  ConfirmDialog,
  EmptyState,
  ErrorStrip,
  GapChip,
  GhostButton,
  LoadingLine,
  PrimaryButton,
  Tag,
} from '../components/primitives';
import type { Process, ProcessStatus } from '../lib/types';

function RowRag({ processId }: { processId: string }): JSX.Element {
  // Per-row rollup from the map graph (cached + shared with the map view).
  const { data: graph, isLoading } = useProcessMap(processId);
  const rollup = graph ? rollupRag(graph.nodes) : 'unknown';
  return (
    <span className="inline-flex items-center gap-1">
      <StatusGlyph status={rollup} size={12} />
      {isLoading ? <span className="text-2xs text-ink-onboard-muted">…</span> : null}
    </span>
  );
}

function RowSteps({ processId }: { processId: string }): JSX.Element {
  const { data: graph } = useProcessMap(processId);
  return <span className="font-mono tabular-nums">{graph ? graph.nodes.length : '—'}</span>;
}

export default function LibraryView(): JSX.Element {
  const { t, locale } = useI18n();
  const { isEditor } = useAuth();
  const navigate = useNavigate();
  const [unownedOnly, setUnownedOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ProcessStatus | ''>('');
  const [archiving, setArchiving] = useState<Process | null>(null);
  const { invalidateProcess } = useInvalidators();

  const filters = {
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(unownedOnly ? { has_unowned: true } : {}),
  };
  const { data: processes, isLoading, isError, error, refetch } = useProcesses(filters);

  async function confirmArchive(): Promise<void> {
    if (!archiving) return;
    const id = archiving.id;
    setArchiving(null);
    try {
      await processApi.archive(id);
      invalidateProcess(id);
      void refetch();
    } catch (err) {
      alert(errorMessage(err, t('error.save')));
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink-onboard">{t('library.title')}</h1>
        {isEditor && <PrimaryButton onClick={() => navigate('/create')}>{t('library.new')}</PrimaryButton>}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-2xs">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ProcessStatus | '')}
          className="rounded-sm border border-board-line bg-board-raised px-2 py-1 text-ink-onboard"
        >
          <option value="">{t('common.all')}</option>
          <option value="draft">{t('pstatus.draft')}</option>
          <option value="active">{t('pstatus.active')}</option>
          <option value="archived">{t('pstatus.archived')}</option>
        </select>
        <label className="flex items-center gap-1 text-ink-onboard-muted">
          <input type="checkbox" checked={unownedOnly} onChange={(e) => setUnownedOnly(e.target.checked)} />
          {t('library.filter.unowned')}
        </label>
      </div>

      {isLoading && <LoadingLine surface="board" />}
      {isError && <ErrorStrip message={errorMessage(error, t('error.load'))} onRetry={() => void refetch()} />}

      {processes && processes.length === 0 && (
        <EmptyState
          surface="board"
          message={isEditor ? t('library.empty.editor') : t('library.empty.viewer')}
          action={isEditor ? <PrimaryButton onClick={() => navigate('/create')}>{t('library.new')}</PrimaryButton> : undefined}
        />
      )}

      {processes && processes.length > 0 && (
        <table className="w-full border-collapse text-sm text-ink-onboard">
          <thead>
            <tr className="border-b border-board-line text-left text-2xs uppercase tracking-label text-ink-onboard-muted">
              <th className="py-2 pr-3 font-medium">{t('library.col.title')}</th>
              <th className="py-2 pr-3 font-medium">{t('library.col.status')}</th>
              <th className="py-2 pr-3 font-medium">{t('library.col.steps')}</th>
              <th className="py-2 pr-3 font-medium">{t('library.col.health')}</th>
              <th className="py-2 pr-3 font-medium">{t('library.col.owner')}</th>
              {isEditor && <th className="py-2 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {processes.map((p) => (
              <tr
                key={p.id}
                className="cursor-pointer border-b border-board-line hover:bg-board-hover"
                onClick={() => navigate(`/process/${p.id}`)}
              >
                <td className="py-2 pr-3">
                  <div className="font-medium">{pickBilingual(locale, p.title_es, p.title_en)}</div>
                  {locale === 'en' && p.title_en && p.title_en !== p.title_es && (
                    <div className="text-2xs text-ink-onboard-muted">{p.title_es}</div>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <Tag surface="board">{t(`pstatus.${p.status}`)}</Tag>
                </td>
                <td className="py-2 pr-3">
                  <RowSteps processId={p.id} />
                </td>
                <td className="py-2 pr-3">
                  <RowRag processId={p.id} />
                </td>
                <td className="py-2 pr-3">
                  {p.overall_owner_party_id ? (
                    <span className="text-ink-onboard-muted">·</span>
                  ) : (
                    <GapChip>{t('library.noOwner')}</GapChip>
                  )}
                </td>
                {isEditor && (
                  <td className="py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    {p.status !== 'archived' && (
                      <GhostButton surface="board" onClick={() => setArchiving(p)} className="text-2xs">
                        {t('common.archive')}
                      </GhostButton>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {archiving && (
        <ConfirmDialog
          title={t('common.archive')}
          message={`${t('common.archive')}: ${pickBilingual(locale, archiving.title_es, archiving.title_en)}?`}
          confirmLabel={t('common.archive')}
          onConfirm={confirmArchive}
          onCancel={() => setArchiving(null)}
        />
      )}
    </div>
  );
}

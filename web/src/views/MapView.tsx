// VIEW 2 — Process Map (Mapa del Proceso). Horizontal scrollable card flow.
// Replaced React Flow canvas with a plain CSS/React card row — no canvas sizing or fitView issues.
// Steps are dark cards arranged left-to-right with SVG arrow connectors. Non-sequential edges
// (branch/loop/parallel) shown as coloured chips on the source card. Click a card → StepDetailPanel.

import { useCallback, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { useFreshness, useProcessMap, errorMessage } from '../lib/hooks';
import { countUnconfirmed } from '../lib/endpoints';
import { pickBilingual } from '../i18n/bilingual';
import { StatusGlyph } from '../components/channels';
import { Legend } from '../components/map/Legend';
import { ErrorStrip, GhostButton, PrimaryButton } from '../components/primitives';
import { StepDetailPanel } from '../components/StepDetailPanel';
import { StepFormModal } from '../components/StepFormModal';
import { ConnectionsModal } from '../components/ConnectionsModal';
import type { GraphEdge, GraphNode } from '../lib/types';
import type { Locale } from '../i18n/strings';

type Filter = 'none' | 'red' | 'unowned' | 'noDoc';

const EDGE_COLOR: Record<string, string> = {
  sequential: '#3A4A55',
  branch: '#F4A83A',
  loop: '#8B9AA6',
  parallel: '#3FB6C9',
};

const EDGE_SYMBOL: Record<string, string> = {
  branch: '⑂',
  loop: '↩',
  parallel: '∥',
};

function StepCard({
  node,
  outEdges,
  seqOf,
  locale,
  selected,
  dimmed,
  freshnessActive,
  onClick,
}: {
  node: GraphNode;
  outEdges: GraphEdge[];
  seqOf: Map<string, number>;
  locale: Locale;
  selected: boolean;
  dimmed: boolean;
  freshnessActive: boolean;
  onClick: () => void;
}): JSX.Element {
  const critical = node.classification === 'CRITICAL';
  const dashed = node.confidence !== 'CONFIRMED';
  const inferred = node.confidence === 'INFERRED';
  const borderColor = selected ? '#3FB6C9' : '#2C3A45';
  const title = pickBilingual(locale, node.title_es, node.title_en);
  const nonSeqEdges = outEdges.filter(e => e.kind !== 'sequential');

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onClick(); }}
      style={{
        background: '#1E2932',
        border: `2px ${dashed ? 'dashed' : 'solid'} ${borderColor}`,
        borderRadius: 4,
        opacity: dimmed ? 0.35 : inferred ? 0.88 : 1,
        boxShadow: selected ? '0 0 0 3px rgba(63,182,201,0.35)' : 'none',
        width: 184,
        minHeight: 110,
        cursor: 'pointer',
        position: 'relative',
        flexShrink: 0,
        padding: critical ? '8px 10px 8px 15px' : '8px 10px',
      }}
      className="font-ui text-ink-onboard"
    >
      {critical && (
        <span
          aria-hidden
          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: '#2E94A4', borderRadius: '4px 0 0 4px' }}
        />
      )}

      {/* Sequence + RAG */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <span style={{ fontFamily: 'monospace', fontSize: 17, lineHeight: 1, color: '#E4EAEF', fontWeight: 500 }}>
          {node.sequence_index}
        </span>
        <StatusGlyph status={node.rag_status} surface="board" size={14} />
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.35,
          fontWeight: critical ? 600 : 500,
          color: '#E4EAEF',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          marginBottom: 6,
        }}
      >
        {title}
      </div>

      {/* Owner */}
      <div style={{ fontSize: 11, color: '#8B9AA6', marginBottom: 4 }}>
        {node.has_owner_gap ? (
          <span style={{ border: '1px solid #8B9AA6', borderRadius: 2, padding: '0 3px', fontSize: 10 }}>
            ○ Sin dueño
          </span>
        ) : (
          <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.owner?.name ?? ''}
          </span>
        )}
      </div>

      {/* Non-sequential edge chips (branch/loop/parallel targets) */}
      {nonSeqEdges.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginBottom: 2 }}>
          {nonSeqEdges.map(e => (
            <span
              key={e.id}
              title={e.condition_es ?? e.kind}
              style={{
                fontSize: 10,
                color: EDGE_COLOR[e.kind] ?? '#8B9AA6',
                border: `1px solid ${EDGE_COLOR[e.kind] ?? '#8B9AA6'}`,
                borderRadius: 2,
                padding: '0 3px',
                lineHeight: 1.6,
              }}
            >
              {EDGE_SYMBOL[e.kind] ?? '→'} P{seqOf.get(e.to_step_id) ?? '?'}
            </span>
          ))}
        </div>
      )}

      {/* Foot icons */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, fontSize: 11, color: '#8B9AA6', marginTop: 4 }}>
        {node.document_count > 0 && <span title="documentos">▤{node.document_count}</span>}
        {freshnessActive && <span style={{ color: '#F4A83A' }} title="alerta de frescura">!</span>}
      </div>
    </div>
  );
}

function Arrow(): JSX.Element {
  return (
    <div style={{ width: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width="28" height="16" viewBox="0 0 28 16" fill="none">
        <line x1="0" y1="8" x2="20" y2="8" stroke="#2C3A45" strokeWidth="1.5" />
        <polygon points="20,4 28,8 20,12" fill="#2C3A45" />
      </svg>
    </div>
  );
}

export default function MapView(): JSX.Element {
  const { processId } = useParams();
  const { t, locale } = useI18n();
  const { isEditor } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedStepId = searchParams.get('step');

  const { data: graph, isLoading, isError, error, refetch } = useProcessMap(processId);
  const { data: freshness } = useFreshness(processId);
  const [filter, setFilter] = useState<Filter>('none');
  const [showAddStep, setShowAddStep] = useState(false);
  const [showConnections, setShowConnections] = useState(false);

  const freshnessStepIds = useMemo(
    () => new Set((freshness?.flags ?? []).map(f => f.step_id).filter((x): x is string => Boolean(x))),
    [freshness],
  );

  const dimmedIds = useMemo(() => {
    const ids = new Set<string>();
    if (!graph || filter === 'none') return ids;
    for (const n of graph.nodes) {
      const keep =
        (filter === 'red' && n.rag_status === 'red') ||
        (filter === 'unowned' && n.has_owner_gap) ||
        (filter === 'noDoc' && n.document_count === 0);
      if (!keep) ids.add(n.id);
    }
    return ids;
  }, [graph, filter]);

  const orderedNodes = useMemo(
    () => (graph ? [...graph.nodes].sort((a, b) => a.sequence_index - b.sequence_index) : []),
    [graph],
  );

  const seqOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of orderedNodes) m.set(n.id, n.sequence_index);
    return m;
  }, [orderedNodes]);

  const edgesBySource = useMemo(() => {
    const m = new Map<string, GraphEdge[]>();
    for (const e of (graph?.edges ?? [])) {
      const arr = m.get(e.from_step_id) ?? [];
      arr.push(e);
      m.set(e.from_step_id, arr);
    }
    return m;
  }, [graph]);

  const unconfirmed = graph ? countUnconfirmed(graph.nodes) : 0;
  const seedBanner = graph && unconfirmed > 0;

  const onCardClick = useCallback((id: string) => setSearchParams({ step: id }), [setSearchParams]);
  const closePanel = useCallback(() => setSearchParams({}), [setSearchParams]);

  if (isError) {
    return (
      <div className="p-6">
        <ErrorStrip message={errorMessage(error, t('map.error'))} onRetry={() => void refetch()} />
      </div>
    );
  }

  const overlayTop = seedBanner ? 40 : 8;

  return (
    <div className="relative flex-1 bg-board-bg" style={{ height: 'calc(100vh - 48px)', overflow: 'hidden' }}>

      {/* Seed/draft banner */}
      {seedBanner && (
        <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between gap-3 border-b border-status-amber bg-status-amber/10 px-4 py-2 text-2xs text-status-amber">
          <span>
            {t('map.seedBanner')} · <span className="font-mono tabular-nums">{unconfirmed}</span> {t('map.unconfirmed')}
          </span>
          {isEditor && graph && (
            <button
              type="button"
              className="underline"
              onClick={() => {
                const first = [...graph.nodes]
                  .sort((a, b) => a.sequence_index - b.sequence_index)
                  .find(n => n.confidence !== 'CONFIRMED');
                if (first) setSearchParams({ step: first.id });
              }}
            >
              {t('map.jumpInferred')}
            </button>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="absolute left-2 z-20 flex flex-wrap items-center gap-2" style={{ top: overlayTop }}>
        {isEditor && (
          <>
            <PrimaryButton onClick={() => setShowAddStep(true)} className="py-1 text-2xs">
              {t('map.addStep')}
            </PrimaryButton>
            <GhostButton surface="board" onClick={() => setShowConnections(true)} className="py-1 text-2xs">
              {t('map.editConnections')}
            </GhostButton>
          </>
        )}
        <select
          value={filter}
          onChange={e => setFilter(e.target.value as Filter)}
          className="rounded-sm border border-board-line bg-board-raised px-2 py-1 text-2xs text-ink-onboard"
        >
          <option value="none">{t('common.filter')}…</option>
          <option value="red">{t('map.filter.red')}</option>
          <option value="unowned">{t('map.filter.unowned')}</option>
          <option value="noDoc">{t('map.filter.noDoc')}</option>
        </select>
      </div>

      {/* Legend */}
      <div className="absolute right-2 z-20 w-64" style={{ top: overlayTop }}>
        <Legend />
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex h-full items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-ink-onboard-muted">
            <div className="h-[2px] w-40 overflow-hidden bg-board-line">
              <div className="h-full w-1/3 animate-[cct-progress_1.1s_ease-in-out_infinite] bg-accent" />
            </div>
            <span className="text-sm">{t('map.loading')}</span>
          </div>
        </div>
      )}

      {/* Empty */}
      {graph && graph.nodes.length === 0 && !isLoading && (
        <div className="flex h-full items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="rounded-sm border-2 border-dashed border-board-line px-8 py-6 text-ink-onboard-muted">
              {isEditor ? t('map.empty.editor') : t('map.empty.viewer')}
            </div>
            {isEditor && <PrimaryButton onClick={() => setShowAddStep(true)}>{t('map.addStep')}</PrimaryButton>}
          </div>
        </div>
      )}

      {/* Process flow — horizontal scrollable card row */}
      {graph && graph.nodes.length > 0 && !isLoading && (
        <div
          style={{
            position: 'absolute',
            top: overlayTop + 36,
            left: 0,
            right: 0,
            bottom: 0,
            overflowX: 'auto',
            overflowY: 'auto',
            padding: '20px 24px',
          }}
        >
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 0, minHeight: 140 }}>
            {orderedNodes.map((node, idx) => (
              <div key={node.id} style={{ display: 'flex', alignItems: 'center' }}>
                <StepCard
                  node={node}
                  outEdges={edgesBySource.get(node.id) ?? []}
                  seqOf={seqOf}
                  locale={locale}
                  selected={node.id === selectedStepId}
                  dimmed={dimmedIds.has(node.id)}
                  freshnessActive={freshnessStepIds.has(node.id)}
                  onClick={() => onCardClick(node.id)}
                />
                {idx < orderedNodes.length - 1 && <Arrow />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step Detail panel — overlay on the right */}
      {selectedStepId && processId && (
        <StepDetailPanel stepId={selectedStepId} processId={processId} onClose={closePanel} />
      )}

      {showAddStep && processId && (
        <StepFormModal processId={processId} onClose={() => setShowAddStep(false)} onSaved={() => void refetch()} />
      )}
      {showConnections && processId && graph && (
        <ConnectionsModal
          processId={processId}
          nodes={graph.nodes}
          edges={graph.edges}
          onClose={() => setShowConnections(false)}
          onSaved={() => void refetch()}
        />
      )}
    </div>
  );
}

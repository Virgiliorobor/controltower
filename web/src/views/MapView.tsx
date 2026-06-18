// VIEW 2 — Process Map (Mapa del Proceso), THE PRIMARY VIEW. Dark board cockpit. React Flow, left-to-right,
// nodes = steps (3 channels), edges = handoffs (4 kinds). Pan/zoom/Fit (default Fit) + mini-map + reset.
// Click a node → opens the Step Detail panel (overlay on the right; map stays visible — D0-2/DC-9), driven by
// the ?step= query param. Seed/draft banner while steps are INFERRED. Filters dim non-matching nodes (never
// remove). Editors get "+ Paso" and "Editar conexiones". Empty/loading/error/permission states per design_spec.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  type Node,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { useFreshness, useProcessMap, errorMessage } from '../lib/hooks';
import { countUnconfirmed } from '../lib/endpoints';
import { pickBilingual } from '../i18n/bilingual';
import { StepNode, type StepNodeData } from '../components/map/StepNode';
import { edgeTypes } from '../components/map/edges';
import { layoutGraph } from '../components/map/layout';
import { Legend } from '../components/map/Legend';
import { ErrorStrip, GhostButton, PrimaryButton } from '../components/primitives';
import { StepDetailPanel } from '../components/StepDetailPanel';
import { StepFormModal } from '../components/StepFormModal';
import { ConnectionsModal } from '../components/ConnectionsModal';
import type { GraphNode } from '../lib/types';

const nodeTypes = { step: StepNode };

type Filter = 'none' | 'red' | 'unowned' | 'noDoc';

function MapInner(): JSX.Element {
  const { processId } = useParams();
  const { t, locale } = useI18n();
  const { isEditor } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedStepId = searchParams.get('step');
  const rf = useReactFlow();

  const { data: graph, isLoading, isError, error, refetch } = useProcessMap(processId);
  const { data: freshness } = useFreshness(processId);
  const [filter, setFilter] = useState<Filter>('none');
  const [showAddStep, setShowAddStep] = useState(false);
  const [showConnections, setShowConnections] = useState(false);

  const freshnessStepIds = useMemo(
    () => new Set((freshness?.flags ?? []).map((f) => f.step_id).filter((x): x is string => Boolean(x))),
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

  const { rfNodes, rfEdges } = useMemo(() => {
    if (!graph) return { rfNodes: [] as Node<StepNodeData>[], rfEdges: [] };
    return layoutGraph({
      nodes: graph.nodes,
      edges: graph.edges,
      selectedId: selectedStepId,
      dimmedIds,
      freshnessStepIds,
      titleOf: (n: GraphNode) => {
        const titleText = pickBilingual(locale, n.title_es, n.title_en);
        const enGloss = locale === 'en' && n.title_en && n.title_en !== n.title_es ? n.title_es : null;
        return { titleText, enGloss };
      },
      ownerLabelOf: (n: GraphNode) => n.owner?.name ?? '',
      ownerGapLabel: t('step.noOwner'),
    });
  }, [graph, selectedStepId, dimmedIds, freshnessStepIds, locale, t]);

  // Default Fit on load / when the node set changes.
  // 200ms gives React Flow's ResizeObserver time to measure node heights before fitView
  // calculates the bounding box. setTimeout(0) races with measurement and can produce
  // a wrong viewport (nodes positioned off-screen or stacked at the canvas edge).
  useEffect(() => {
    if (rfNodes.length > 0) {
      const id = window.setTimeout(() => rf.fitView({ padding: 0.2, duration: 0 }), 200);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [rf, rfNodes.length, processId]);

  // Secondary fitView on React Flow init. Fires when React Flow first mounts and measures
  // the container. If nodes are already in rfNodes at that point, fit immediately.
  const onRfInit = useCallback(() => {
    if (rfNodes.length > 0) rf.fitView({ padding: 0.2, duration: 0 });
  }, [rf, rfNodes.length]);

  const onNodeClick = useCallback(
    (_: unknown, node: Node<StepNodeData>) => {
      setSearchParams({ step: node.id });
    },
    [setSearchParams],
  );

  const closePanel = useCallback(() => setSearchParams({}), [setSearchParams]);

  const unconfirmed = graph ? countUnconfirmed(graph.nodes) : 0;
  const seedBanner = graph && unconfirmed > 0;

  if (isError) {
    return (
      <div className="p-6">
        <ErrorStrip message={errorMessage(error, t('map.error'))} onRetry={() => void refetch()} />
      </div>
    );
  }

  return (
    <div className="relative flex-1" style={{ height: 'calc(100vh - 48px)' }}>
      {/* Seed/draft banner (visual_spec §3). */}
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
                const first = [...graph.nodes].sort((a, b) => a.sequence_index - b.sequence_index).find((n) => n.confidence !== 'CONFIRMED');
                if (first) setSearchParams({ step: first.id });
              }}
            >
              {t('map.jumpInferred')}
            </button>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className={`absolute ${seedBanner ? 'top-10' : 'top-2'} left-2 z-20 flex flex-wrap items-center gap-2`}>
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
          onChange={(e) => setFilter(e.target.value as Filter)}
          className="rounded-sm border border-board-line bg-board-raised px-2 py-1 text-2xs text-ink-onboard"
        >
          <option value="none">{t('common.filter')}…</option>
          <option value="red">{t('map.filter.red')}</option>
          <option value="unowned">{t('map.filter.unowned')}</option>
          <option value="noDoc">{t('map.filter.noDoc')}</option>
        </select>
      </div>

      <div className={`absolute ${seedBanner ? 'top-10' : 'top-2'} right-2 z-20 w-64`}>
        <Legend />
      </div>

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

      {graph && graph.nodes.length === 0 && (
        <div className="flex h-full items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="rounded-sm border-2 border-dashed border-board-line px-8 py-6 text-ink-onboard-muted">
              {isEditor ? t('map.empty.editor') : t('map.empty.viewer')}
            </div>
            {isEditor && <PrimaryButton onClick={() => setShowAddStep(true)}>{t('map.addStep')}</PrimaryButton>}
          </div>
        </div>
      )}

      {graph && graph.nodes.length > 0 && (
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={onNodeClick}
          onPaneClick={closePanel}
          onInit={onRfInit}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1E2932" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor="#1E2932"
            nodeStrokeColor="#2C3A45"
            maskColor="rgba(14,20,25,0.7)"
            style={{ background: '#161E26', border: '1px solid #2C3A45' }}
          />
        </ReactFlow>
      )}

      {/* Step Detail panel — overlay on the right, map stays visible. */}
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

export default function MapView(): JSX.Element {
  const { processId } = useParams();
  return (
    <ReactFlowProvider key={processId}>
      <MapInner />
    </ReactFlowProvider>
  );
}

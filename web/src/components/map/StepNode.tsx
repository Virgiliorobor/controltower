// The core map node (visual_spec §3 "Map node"). All THREE orthogonal channels coexist here and must stay
// independently readable (DC-3):
//   HUE          → the status glyph (●/◆/▲/○) top-right, colored by rag_status (HEALTH).
//   LINE-TEXTURE → the 2px node border: SOLID = CONFIRMED, DASHED = INFERRED/FLAGGED (CONFIDENCE) + 88% opacity
//                  on INFERRED so it reads "provisional".
//   LEFT SPINE   → a 3px accent-toned left bar + 620-weight title when classification = CRITICAL.
// No two channels share a visual variable, so a red INFERRED CRITICAL node renders all three without collision.

import { Handle, Position, type NodeProps } from 'reactflow';
import { StatusGlyph } from '../channels';
import { StepTypeIcon } from './StepTypeIcon';
import type { GraphNode } from '../../lib/types';

export interface StepNodeData {
  node: GraphNode;
  titleText: string;
  enGloss: string | null; // shown beneath the title in EN mode when present and different
  ownerLabel: string;
  ownerGap: string; // "Sin dueño" when has_owner_gap
  selected: boolean;
  dimmed: boolean; // filtered-out nodes are dimmed, not removed
  freshnessActive: boolean;
}

export function StepNode({ data }: NodeProps<StepNodeData>): JSX.Element {
  const { node } = data;
  const critical = node.classification === 'CRITICAL';
  const inferred = node.confidence === 'INFERRED';
  const dashed = node.confidence !== 'CONFIRMED';

  const borderColor = data.selected ? '#3FB6C9' : '#2C3A45';
  const style: React.CSSProperties = {
    background: '#1E2932',
    border: `2px ${dashed ? 'dashed' : 'solid'} ${borderColor}`,
    borderRadius: 2,
    opacity: data.dimmed ? 0.35 : inferred ? 0.88 : 1,
    boxShadow: data.selected ? '0 0 0 2px #3FB6C9' : 'none',
    width: 196,
    minHeight: 72,
    position: 'relative',
  };

  return (
    <div style={style} className="font-ui text-ink-onboard">
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: 'none' }} />
      {/* CRITICAL left spine bar (channel 3) — accent-press toned, never a status color. */}
      {critical && (
        <span
          aria-hidden
          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: '#2E94A4' }}
        />
      )}
      <div style={{ padding: '8px 10px 8px 12px' }}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1">
            <span className="font-mono text-lg tabular-nums leading-none text-ink-onboard">{node.sequence_index}</span>
            <StepTypeIcon stepType={node.step_type} className="text-ink-onboard-muted" />
          </div>
          {/* HEALTH hue glyph (channel 1). */}
          <StatusGlyph status={node.rag_status} surface="board" size={15} />
        </div>
        <div
          className={`mt-1 text-sm leading-tight ${critical ? 'font-semibold' : 'font-medium'}`}
          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {data.titleText}
        </div>
        {data.enGloss && <div className="text-[11px] text-ink-onboard-muted">{data.enGloss}</div>}

        <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
          {node.has_owner_gap ? (
            <span className="inline-flex items-center gap-1 rounded-sm border border-status-grey px-1 text-status-grey">
              <span aria-hidden>○</span>
              {data.ownerGap}
            </span>
          ) : (
            <span className="truncate text-ink-onboard-muted">{data.ownerLabel}</span>
          )}
          <span className="flex items-center gap-2 font-mono tabular-nums text-ink-onboard-muted">
            {node.document_count > 0 && <span title="docs">▤{node.document_count}</span>}
            {data.freshnessActive && <span className="text-status-amber" title="freshness">!</span>}
          </span>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: 'none' }} />
    </div>
  );
}

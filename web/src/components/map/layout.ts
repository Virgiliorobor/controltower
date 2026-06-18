// Managed left-to-right layout (✱ A2: not a free-drag canvas). Steps are placed on the spine by sequence_index;
// branch targets fan out vertically so the semáforo fork is legible; loop/parallel edges route over/around.
// This is deterministic from the graph data — editors reorder by sequence, the app re-flows (no saved coords).

import { MarkerType, type Edge, type Node } from 'reactflow';
import type { GraphEdge, GraphNode } from '../../lib/types';
import type { StepNodeData } from './StepNode';

const COL_W = 216; // horizontal spacing between sequence columns
const ROW_H = 130; // vertical spacing for branch fan-out
const NODE_W = 196;
const NODE_H = 88; // approximate height — lets fitView calculate before ResizeObserver fires

export interface LayoutInput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  dimmedIds: Set<string>;
  freshnessStepIds: Set<string>;
  titleOf: (n: GraphNode) => { titleText: string; enGloss: string | null };
  ownerLabelOf: (n: GraphNode) => string;
  ownerGapLabel: string;
}

export interface LaidOut {
  rfNodes: Node<StepNodeData>[];
  rfEdges: Edge[];
}

// Assign a vertical lane to each node. Spine nodes sit on lane 0; a branch's secondary target drops a lane so
// the fork is visually split (e.g. Step 9 red-light inspection sits below the spine, rejoining at Step 10).
function computeLanes(nodes: GraphNode[], edges: GraphEdge[]): Map<string, number> {
  const lane = new Map<string, number>();
  for (const n of nodes) lane.set(n.id, 0);
  const seqOf = new Map(nodes.map((n) => [n.id, n.sequence_index]));
  // For each branch handoff, push the lower-sequence-delta target down a lane if it is "off-spine".
  const branchTargets = edges.filter((e) => e.kind === 'branch');
  // Group branch edges by source; the SECOND+ legs drop to lanes 1,2,... (the first leg stays on the spine).
  const bySource = new Map<string, GraphEdge[]>();
  for (const e of branchTargets) {
    const arr = bySource.get(e.from_step_id) ?? [];
    arr.push(e);
    bySource.set(e.from_step_id, arr);
  }
  for (const [, legs] of bySource) {
    const sorted = [...legs].sort((a, b) => (seqOf.get(a.to_step_id) ?? 0) - (seqOf.get(b.to_step_id) ?? 0));
    sorted.forEach((leg, idx) => {
      if (idx > 0) {
        // off-spine leg → drop a lane (don't override if it later rejoins as a spine target)
        const cur = lane.get(leg.to_step_id) ?? 0;
        if (cur === 0) lane.set(leg.to_step_id, idx);
      }
    });
  }
  // Parallel targets get their own lane below the spine too.
  for (const e of edges.filter((x) => x.kind === 'parallel')) {
    if ((lane.get(e.to_step_id) ?? 0) === 0) lane.set(e.to_step_id, 1);
  }
  return lane;
}

export function layoutGraph(input: LayoutInput): LaidOut {
  const { nodes, edges, selectedId, dimmedIds, freshnessStepIds } = input;
  const ordered = [...nodes].sort((a, b) => a.sequence_index - b.sequence_index);
  const lanes = computeLanes(ordered, edges);
  // Column index = rank by sequence (compact, ignores gaps in sequence_index numbering).
  const colOf = new Map<string, number>();
  ordered.forEach((n, i) => colOf.set(n.id, i));

  const rfNodes: Node<StepNodeData>[] = ordered.map((n) => {
    const { titleText, enGloss } = input.titleOf(n);
    return {
      id: n.id,
      type: 'step',
      position: { x: (colOf.get(n.id) ?? 0) * COL_W, y: (lanes.get(n.id) ?? 0) * ROW_H },
      data: {
        node: n,
        titleText,
        enGloss,
        ownerLabel: input.ownerLabelOf(n),
        ownerGap: input.ownerGapLabel,
        selected: n.id === selectedId,
        dimmed: dimmedIds.has(n.id),
        freshnessActive: freshnessStepIds.has(n.id),
      },
      width: NODE_W,
      height: NODE_H,
      draggable: false,
      selectable: true,
    };
  });

  const rfEdges: Edge[] = edges.map((e) => {
    const condition = e.condition_es ?? e.condition_en ?? null;
    return {
      id: e.id,
      source: e.from_step_id,
      target: e.to_step_id,
      type: e.kind, // matches edgeTypes keys: sequential | branch | loop | parallel
      data: { label: condition },
      markerEnd: { type: MarkerType.ArrowClosed, color: e.kind === 'loop' ? '#8B9AA6' : '#3A4A55', width: 14, height: 14 },
    };
  });

  return { rfNodes, rfEdges };
}

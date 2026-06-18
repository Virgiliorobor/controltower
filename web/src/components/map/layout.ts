// Dagre-powered auto-layout (A2: managed layout, not free drag).
// Dagre treats the process graph as a directed graph and positions nodes
// in 2D space: sequential steps rank left-to-right, branches fan out vertically,
// loops get their own rank. Results in a real flowchart, not a line.

import dagre from '@dagrejs/dagre';
import { MarkerType, type Edge, type Node } from 'reactflow';
import type { GraphEdge, GraphNode } from '../../lib/types';
import type { StepNodeData } from './StepNode';

const NODE_W = 200;
const NODE_H = 92;

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

export function layoutGraph(input: LayoutInput): LaidOut {
  const { nodes, edges, selectedId, dimmedIds, freshnessStepIds } = input;

  // Build a dagre graph and run layout.
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'LR',  // left-to-right flow
    nodesep: 60,    // vertical gap between nodes in the same column
    ranksep: 80,    // horizontal gap between columns
    marginx: 20,
    marginy: 20,
  });

  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_W, height: NODE_H });
  }

  for (const e of edges) {
    // Only add edges once to dagre (for layout — render all variants below).
    g.setEdge(e.from_step_id, e.to_step_id);
  }

  dagre.layout(g);

  // Dagre gives center coordinates; React Flow expects top-left corner.
  const rfNodes: Node<StepNodeData>[] = nodes.map((n) => {
    const pos = g.node(n.id);
    const { titleText, enGloss } = input.titleOf(n);
    return {
      id: n.id,
      type: 'step',
      position: {
        x: pos.x - NODE_W / 2,
        y: pos.y - NODE_H / 2,
      },
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
      type: e.kind,
      data: { label: condition },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: e.kind === 'loop' ? '#8B9AA6' : '#3A4A55',
        width: 14,
        height: 14,
      },
    };
  });

  return { rfNodes, rfEdges };
}

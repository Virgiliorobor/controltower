// The FOUR handoff edge kinds (DC-2 / visual_spec §3 Edges). Each is drawn DISTINCTLY so the structure reads
// instantly and is never flattened:
//   sequential → 1.5px SOLID straight connector + arrowhead.
//   branch     → SOLID fork leg WITH a mandatory condition label chip (a branch leg without a label is a defect).
//                Labels use accent/neutral chrome, NOT status-green/red (the VERDE/ROJO words carry the customs
//                meaning; the RAG palette stays reserved for node health — visual_spec §2 note).
//   loop       → DASHED CURVED return edge routed ABOVE the spine, reverse arrow, condition label → reads as a
//                return path, never a forward step.
//   parallel   → DOUBLE HAIRLINE (two parallel 1px rules) → reads "concurrent".
// condition labels: each edge passes data.label (the resolved bilingual condition) which we render in a chip.

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  type EdgeProps,
} from 'reactflow';

const LINE = '#3A4A55'; // board-line-light
const LOOP = '#8B9AA6'; // ink-onboard-muted (the loop reads as a meta/return path)

interface EdgeData {
  label?: string | null;
}

function LabelChip({
  x,
  y,
  text,
}: {
  x: number;
  y: number;
  text: string;
}): JSX.Element {
  return (
    <EdgeLabelRenderer>
      <div
        style={{
          position: 'absolute',
          transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
          pointerEvents: 'all',
        }}
        className="rounded-sm border border-board-line bg-board-panel px-2 py-[1px] font-ui text-[10px] tracking-label text-ink-onboard"
      >
        {text}
      </div>
    </EdgeLabelRenderer>
  );
}

export function SequentialEdge(props: EdgeProps<EdgeData>): JSX.Element {
  const [path] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    borderRadius: 2,
  });
  return <BaseEdge path={path} markerEnd={props.markerEnd} style={{ stroke: LINE, strokeWidth: 1.5 }} />;
}

export function BranchEdge(props: EdgeProps<EdgeData>): JSX.Element {
  // A visibly forking leg: bezier from the source so multiple branch legs splay out of the fork node.
  const [path, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  });
  return (
    <>
      <BaseEdge path={path} markerEnd={props.markerEnd} style={{ stroke: LINE, strokeWidth: 1.5 }} />
      {props.data?.label && <LabelChip x={labelX} y={labelY} text={props.data.label} />}
    </>
  );
}

export function LoopEdge(props: EdgeProps<EdgeData>): JSX.Element {
  // Dashed curved return routed ABOVE the spine. We hand-build an arc that bows upward and points back.
  const { sourceX, sourceY, targetX, targetY } = props;
  const midX = (sourceX + targetX) / 2;
  const bow = Math.min(120, Math.abs(sourceX - targetX) / 2 + 60);
  const topY = Math.min(sourceY, targetY) - bow;
  const path = `M ${sourceX},${sourceY} C ${sourceX},${topY} ${targetX},${topY} ${targetX},${targetY}`;
  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={props.markerEnd}
        style={{ stroke: LOOP, strokeWidth: 1.5, strokeDasharray: '5 4' }}
      />
      {props.data?.label && <LabelChip x={midX} y={topY} text={props.data.label} />}
    </>
  );
}

export function ParallelEdge(props: EdgeProps<EdgeData>): JSX.Element {
  // Double hairline: render the smoothstep path twice with a small perpendicular offset.
  const [path] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    borderRadius: 2,
  });
  const labelX = (props.sourceX + props.targetX) / 2;
  const labelY = (props.sourceY + props.targetY) / 2 - 8;
  return (
    <>
      <g transform="translate(0,-2)">
        <BaseEdge path={path} style={{ stroke: LINE, strokeWidth: 1 }} />
      </g>
      <g transform="translate(0,2)">
        <BaseEdge path={path} markerEnd={props.markerEnd} style={{ stroke: LINE, strokeWidth: 1 }} />
      </g>
      {props.data?.label && <LabelChip x={labelX} y={labelY} text={props.data.label} />}
    </>
  );
}

export const edgeTypes = {
  sequential: SequentialEdge,
  branch: BranchEdge,
  loop: LoopEdge,
  parallel: ParallelEdge,
};

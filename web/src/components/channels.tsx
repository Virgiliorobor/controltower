// The THREE orthogonal status channels (visual_spec §2 / DC-3) — each uses a different visual variable so they
// can never be confused on a node:
//   1. HEALTH (RAG)  → HUE + fixed SHAPE glyph + WORD  (StatusGlyph / StatusStamp). Reserved for step health.
//   2. CONFIDENCE    → LINE-TEXTURE (solid/dashed) + opacity + monochrome TAG (ConfidenceTag). Never a color.
//   3. CRITICAL      → LEFT SPINE BAR + weight, or an outline CHIP in the detail (CriticalChip). Never a color.
// The status glyph silhouettes (● disc / ◆ diamond / ▲ triangle / ○ ring) carry the meaning without hue.

import type { Confidence, RagStatus } from '../lib/types';
import { useI18n } from '../i18n/I18nContext';

const RAG_GLYPH: Record<RagStatus, string> = {
  green: '●', // solid filled disc
  amber: '◆', // filled diamond
  red: '▲', // filled triangle
  unknown: '○', // hollow ring
};

const RAG_KEY: Record<RagStatus, string> = {
  green: 'status.green',
  amber: 'status.amber',
  red: 'status.red',
  unknown: 'status.grey',
};

// Board (dark) glyph colors.
const RAG_COLOR_BOARD: Record<RagStatus, string> = {
  green: '#27B85C',
  amber: '#E8A317',
  red: '#E5484D',
  unknown: '#5A6A75',
};
// Doc (light sheet) glyph colors — darker for AA on the light surface.
const RAG_COLOR_DOC: Record<RagStatus, string> = {
  green: '#1B8E45',
  amber: '#B97D00',
  red: '#C32B30',
  unknown: '#7A8590',
};

export function ragColor(status: RagStatus, surface: 'board' | 'doc'): string {
  return surface === 'doc' ? RAG_COLOR_DOC[status] : RAG_COLOR_BOARD[status];
}

// Bare colored shape glyph — used on map nodes (no word) and inline.
export function StatusGlyph({
  status,
  surface = 'board',
  size = 14,
}: {
  status: RagStatus;
  surface?: 'board' | 'doc';
  size?: number;
}): JSX.Element {
  const { t } = useI18n();
  const label = t(RAG_KEY[status]);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{ color: ragColor(status, surface), fontSize: size, lineHeight: 1 }}
    >
      {RAG_GLYPH[status]}
    </span>
  );
}

// The full Status Stamp (the signature): a 2px inset plate {colored glyph + uppercase word} — health only.
export function StatusStamp({
  status,
  surface = 'doc',
}: {
  status: RagStatus;
  surface?: 'board' | 'doc';
}): JSX.Element {
  const { t } = useI18n();
  const color = ragColor(status, surface);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm border px-2 py-[2px] text-2xs font-medium uppercase tracking-label"
      style={{ borderColor: color, color }}
    >
      <span aria-hidden style={{ lineHeight: 1 }}>{RAG_GLYPH[status]}</span>
      {t(RAG_KEY[status])}
    </span>
  );
}

// CONFIDENCE tag — monochrome texture + word. Solid border = CONFIRMED; dashed = INFERRED/FLAGGED. No hue.
export function ConfidenceTag({
  confidence,
  surface = 'doc',
}: {
  confidence: Confidence;
  surface?: 'board' | 'doc';
}): JSX.Element {
  const { t } = useI18n();
  const key =
    confidence === 'CONFIRMED' ? 'confidence.confirmed' : confidence === 'INFERRED' ? 'confidence.inferred' : 'confidence.flagged';
  const dashed = confidence !== 'CONFIRMED';
  const line = surface === 'doc' ? '#46505A' : '#8B9AA6';
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm px-2 py-[2px] text-2xs font-medium uppercase tracking-label"
      style={{ border: `1px ${dashed ? 'dashed' : 'solid'} ${line}`, color: line }}
    >
      {confidence === 'FLAGGED' && <span aria-hidden>⌐</span>}
      {t(key)}
    </span>
  );
}

// CRITICAL chip — outline only, no color. Absence is the signal for non-critical steps.
export function CriticalChip({ surface = 'doc' }: { surface?: 'board' | 'doc' }): JSX.Element {
  const { t } = useI18n();
  const line = surface === 'doc' ? '#0C1116' : '#E4EAEF';
  return (
    <span
      className="inline-flex items-center rounded-sm px-2 py-[2px] text-2xs font-semibold uppercase tracking-label"
      style={{ border: `1px solid ${line}`, color: line }}
    >
      {t('classification.critical')}
    </span>
  );
}

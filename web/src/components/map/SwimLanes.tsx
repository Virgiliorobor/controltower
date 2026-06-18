// Geographic zone bands rendered behind the React Flow canvas.
// Three fixed-width columns: EE.UU. → Aduana / Frontera → México.
// Bands are viewport-fixed — they don't pan/zoom with nodes. For the IMMEX MX←US
// process the dagre L→R layout places origin steps left, customs steps centre,
// and plant/destination steps right, so the zones read correctly without pan.
// Colors are deliberately off-palette (not RAG) and at ~6% opacity so they add
// spatial context without competing with node health color.

import { useI18n } from '../../i18n/I18nContext';

const ZONES = [
  {
    key: 'us',
    labelKey: 'map.zone.us',
    width: '30%',
    bg: 'rgba(96,148,210,0.06)',
    accent: 'rgba(96,148,210,0.50)',
    divider: 'rgba(44,58,69,0.7)',
  },
  {
    key: 'border',
    labelKey: 'map.zone.border',
    width: '40%',
    bg: 'rgba(210,165,75,0.06)',
    accent: 'rgba(210,165,75,0.50)',
    divider: 'rgba(44,58,69,0.7)',
  },
  {
    key: 'mx',
    labelKey: 'map.zone.mx',
    width: '30%',
    bg: 'rgba(63,182,175,0.06)',
    accent: 'rgba(63,182,175,0.50)',
    divider: undefined,
  },
] as const;

export function SwimLanes(): JSX.Element {
  const { t } = useI18n();
  return (
    <div
      className="absolute inset-0 flex"
      aria-hidden
      style={{ pointerEvents: 'none' }}
    >
      {ZONES.map((z) => (
        <div
          key={z.key}
          style={{
            width: z.width,
            flexShrink: 0,
            background: z.bg,
            borderRight: z.divider ? `1px solid ${z.divider}` : undefined,
          }}
        >
          <div
            style={{ borderTop: `2px solid ${z.accent}` }}
            className="px-3 pt-2 pb-1"
          >
            <span
              className="font-ui text-2xs uppercase tracking-label select-none"
              style={{ color: z.accent }}
            >
              {t(z.labelKey)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

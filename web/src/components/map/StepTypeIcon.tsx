// Step type icons — one per StepType, 16×16 viewBox, stroke-based, no external dependency.
// Nounproject-style: clean single-weight strokes, no fills except small terminal dots on ForkIcon.

import type { StepType } from '../../lib/types';

const SZ = 14;
const SW = 1.4;

function DocIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={SZ} height={SZ} fill="none" stroke="currentColor"
         strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 2h6l3 3v9H4V2z" />
      <path d="M10 2v3h3" />
      <line x1="6.5" y1="7.5" x2="10.5" y2="7.5" />
      <line x1="6.5" y1="10" x2="10.5" y2="10" />
    </svg>
  );
}

function VerifyIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={SZ} height={SZ} fill="none" stroke="currentColor"
         strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.5" y1="10.5" x2="14" y2="14" strokeWidth="1.8" />
      <polyline points="5,7 6.5,8.5 9.5,5.5" />
    </svg>
  );
}

function ForkIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={SZ} height={SZ} fill="none" stroke="currentColor"
         strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 8h5" />
      <path d="M7 8L13.5 4.5" />
      <path d="M7 8L13.5 11.5" />
      <circle cx="13.5" cy="4.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="13.5" cy="11.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function EnvelopeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={SZ} height={SZ} fill="none" stroke="currentColor"
         strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="4.5" width="12" height="8" />
      <polyline points="2,5 8,10 14,5" />
    </svg>
  );
}

function BoxIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={SZ} height={SZ} fill="none" stroke="currentColor"
         strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="2,6.5 8,3 14,6.5" />
      <path d="M2 6.5v7h12v-7" />
      <polyline points="2,6.5 8,10 14,6.5" />
      <line x1="8" y1="10" x2="8" y2="13.5" />
    </svg>
  );
}

const ICONS: Record<StepType, () => JSX.Element> = {
  DOCUMENTATION: DocIcon,
  VERIFICATION: VerifyIcon,
  ROUTING: ForkIcon,
  COMMUNICATION: EnvelopeIcon,
  TRANSFORMATION: BoxIcon,
};

export function StepTypeIcon({
  stepType,
  className,
}: {
  stepType: StepType | null;
  className?: string;
}): JSX.Element | null {
  if (!stepType) return null;
  const Icon = ICONS[stepType];
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center' }}>
      <Icon />
    </span>
  );
}

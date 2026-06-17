// Shared UI primitives, styled to the Control Room Slate tokens + Banned List (2px radius, no shadows except the
// one panel anchor, no gradients, hairline rules, determinate progress — never shimmer/spinner-bounce).
// `surface` switches a primitive between the dark board and the light doc sheet where it can appear on both.

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useI18n } from '../i18n/I18nContext';

type Surface = 'board' | 'doc';

// --- Buttons (component_styling §3). Exactly one primary per view. ---
export function PrimaryButton({
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      {...rest}
      className={`rounded-sm bg-accent-press px-4 py-2 text-sm font-semibold text-white transition-colors duration-feedback hover:bg-accent disabled:cursor-not-allowed disabled:bg-board-line disabled:text-ink-onboard-muted ${className}`}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  surface = 'board',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; surface?: Surface }): JSX.Element {
  const tone =
    surface === 'doc'
      ? 'border-doc-line text-ink hover:bg-doc-raised'
      : 'border-board-line text-ink-onboard hover:bg-board-hover';
  return (
    <button
      type="button"
      {...rest}
      className={`rounded-sm border px-3 py-2 text-sm transition-colors duration-feedback disabled:cursor-not-allowed disabled:opacity-50 ${tone} ${className}`}
    >
      {children}
    </button>
  );
}

export function DestructiveButton({
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      {...rest}
      className={`rounded-sm border border-status-red px-3 py-2 text-sm text-status-red transition-colors duration-feedback hover:bg-status-red/10 disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

// --- Gap chip (DC-5): honest "what's missing", never a blank. Amber/grey tint draws the eye. ---
export function GapChip({ children, tone = 'grey' }: { children: ReactNode; tone?: 'grey' | 'amber' }): JSX.Element {
  const cls =
    tone === 'amber'
      ? 'border-status-amber text-status-amber-doc bg-status-amber/10'
      : 'border-status-grey text-status-grey bg-status-grey/10';
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm border px-2 py-[1px] text-2xs ${cls}`}>{children}</span>
  );
}

// "ES" tag shown beside an ES value rendered in EN mode when the EN gloss is missing (D0-5).
export function EsTag(): JSX.Element {
  return (
    <span className="ml-1 inline-flex items-center rounded-sm border border-current px-1 text-[9px] font-medium uppercase tracking-label opacity-70">
      ES
    </span>
  );
}

// Outline tag/badge (kinds, formats, etc.).
export function Tag({ children, surface = 'doc' }: { children: ReactNode; surface?: Surface }): JSX.Element {
  const tone = surface === 'doc' ? 'border-doc-line text-ink-muted' : 'border-board-line text-ink-onboard-muted';
  return <span className={`inline-flex items-center rounded-sm border px-2 py-[1px] text-2xs ${tone}`}>{children}</span>;
}

// --- Form fields (doc surface). accent focus ring; inline error in status-red below. ---
export function Field({
  label,
  required,
  error,
  children,
  hint,
}: {
  label: string;
  required?: boolean;
  error?: string | null;
  children: ReactNode;
  hint?: string;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-label text-ink-muted">
        {label}
        {required ? <span className="text-status-red-doc"> *</span> : <span className="ml-1 opacity-60">({t('common.optional')})</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-2xs text-ink-muted">{hint}</span>}
      {error && <span className="mt-1 block text-2xs text-status-red-doc">{error}</span>}
    </label>
  );
}

const inputCls =
  'w-full rounded-sm border border-doc-line bg-doc-raised px-3 py-2 text-base text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent';

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return <input {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return <textarea {...props} className={`${inputCls} min-h-[64px] leading-wiki ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return <select {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

// --- States (Banned-list compliant: no shimmer, no spinner-bounce, no emoji). ---

// Determinate accent progress bar — the ONLY loading affordance for AI states (DC-4).
export function ProgressBar({ label }: { label?: string }): JSX.Element {
  return (
    <div className="w-full">
      {label && <div className="mb-1 text-2xs text-ink-muted">{label}</div>}
      <div className="h-[2px] w-full overflow-hidden bg-doc-line">
        <div className="h-full w-1/3 animate-[cct-progress_1.1s_ease-in-out_infinite] bg-accent" />
      </div>
    </div>
  );
}

export function LoadingLine({ label, surface = 'board' }: { label?: string; surface?: Surface }): JSX.Element {
  const { t } = useI18n();
  const tone = surface === 'doc' ? 'text-ink-muted' : 'text-ink-onboard-muted';
  return (
    <div className={`flex flex-col items-center gap-2 py-8 ${tone}`}>
      <div className="h-[2px] w-40 overflow-hidden bg-board-line">
        <div className="h-full w-1/3 animate-[cct-progress_1.1s_ease-in-out_infinite] bg-accent" />
      </div>
      <span className="text-sm">{label ?? t('app.loading')}</span>
    </div>
  );
}

export function ErrorStrip({
  message,
  onRetry,
  surface = 'board',
}: {
  message: string;
  onRetry?: () => void;
  surface?: Surface;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-3 rounded-sm border border-status-red bg-status-red/5 px-4 py-3">
      <span className="text-sm text-status-red">{message}</span>
      {onRetry && (
        <GhostButton surface={surface} onClick={onRetry}>
          {t('common.retry')}
        </GhostButton>
      )}
    </div>
  );
}

export function EmptyState({
  message,
  action,
  surface = 'board',
}: {
  message: string;
  action?: ReactNode;
  surface?: Surface;
}): JSX.Element {
  const tone = surface === 'doc' ? 'text-ink-muted' : 'text-ink-onboard-muted';
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <p className={`text-sm ${tone}`}>{message}</p>
      {action}
    </div>
  );
}

// --- Modal overlay (doc surface sheet centered) — for upload, create chooser, confirm dialogs. ---
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className={`max-h-[90vh] w-full overflow-y-auto rounded-sm border border-doc-line bg-doc-surface text-ink ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-doc-line px-6 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="text-ink-muted hover:text-ink">
            ✕
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// Confirm dialog (destructive actions require a confirm — §3).
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  destructive = true,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="text-base leading-wiki text-ink">{message}</p>
      <div className="mt-6 flex justify-end gap-2">
        <GhostButton surface="doc" onClick={onCancel}>
          {t('common.cancel')}
        </GhostButton>
        {destructive ? (
          <DestructiveButton onClick={onConfirm}>{confirmLabel}</DestructiveButton>
        ) : (
          <PrimaryButton onClick={onConfirm}>{confirmLabel}</PrimaryButton>
        )}
      </div>
    </Modal>
  );
}

// VIEW 3 — Step Detail panel (Detalle del Paso). The lighter reading sheet over the dark board (Per-View: do
// NOT render this dark — the surface contrast IS the direction). Right-hand overlay; map stays visible; the
// selected node is highlighted (D0-2/DC-9). Anchored by the single flat left-edge shadow (panel-anchor).
//
// Header: sequence + title + the THREE channel markers each in its own visual language (StatusStamp / texture
// ConfidenceTag / outline CriticalChip). Then the wiki record: description/trigger/action/reason, inputs/outputs,
// responsible party + contact (gap chips, never blank — DC-5), documents (preview/download; editor replace),
// common issues, outgoing handoffs (so branch/loop reads from the detail too), freshness nudges (non-binding;
// viewers see status only), metadata. Editors get Edit/Save, Mark reviewed, Mark CONFIRMED, Attach doc, Re-interview.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { useStepDetail, useFreshness, useInvalidators, errorMessage } from '../lib/hooks';
import { resolveBilingual, pickBilingual, formatDate } from '../i18n/bilingual';
import { stepApi } from '../lib/endpoints';
import { StatusStamp, ConfidenceTag, CriticalChip } from './channels';
import {
  ConfirmDialog,
  EsTag,
  GapChip,
  GhostButton,
  LoadingLine,
  Tag,
} from './primitives';
import { StepEditForm } from './StepEditForm';
import { PartyPicker } from './PartyPicker';
import { DocumentUploadModal } from './DocumentUploadModal';
import { DocumentPreviewModal } from './DocumentPreviewModal';
import type { FreshnessFlag, StepDetail } from '../lib/types';

function FieldBlock({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="border-t border-doc-line py-3">
      <div className="mb-1 text-xs font-medium uppercase tracking-label text-ink-muted">{label}</div>
      <div className="text-base leading-wiki text-ink">{children}</div>
    </div>
  );
}

// A bilingual value: shows the resolved text; if EN-mode fell back to ES, appends the "ES" tag (DC-5); if empty,
// shows nothing (the caller decides whether to render a gap chip).
function BilingualValue({ es, en }: { es: string | null; en: string | null }): JSX.Element | null {
  const { locale } = useI18n();
  const r = resolveBilingual(locale, es, en);
  if (r.empty || !r.text) return null;
  return (
    <span>
      {r.text}
      {r.esFallback && <EsTag />}
    </span>
  );
}

function FreshnessNudge({ flag, stepId, processId, canAct }: { flag: FreshnessFlag; stepId: string; processId: string; canAct: boolean }): JSX.Element {
  const { t, locale } = useI18n();
  const { invalidateStep, invalidateProcess } = useInvalidators();
  const text = locale === 'es' ? flag.detail_es : flag.detail_en || flag.detail_es;
  return (
    <div className="mt-2 rounded-sm border border-accent/40 bg-accent-ghost px-3 py-2 text-sm text-ink">
      <div className="mb-1 flex items-center gap-2">
        <span aria-hidden className="inline-block h-3 w-[2px] bg-accent" />
        <span className="text-2xs uppercase tracking-label text-ink-muted">{t(`fresh.${flag.kind}`)}</span>
        <Tag surface="doc">{t(`sev.${flag.severity}`)}</Tag>
      </div>
      <p className="leading-wiki">{text}</p>
      <p className="mt-1 text-2xs italic text-ink-muted">{t('freshness.suggestionOnly')}</p>
      {canAct && (
        <div className="mt-2 flex gap-2">
          <GhostButton
            surface="doc"
            className="py-1 text-2xs"
            onClick={async () => {
              await stepApi.review(stepId);
              invalidateStep(stepId);
              invalidateProcess(processId);
            }}
          >
            {t('freshness.confirmCurrent')}
          </GhostButton>
        </div>
      )}
    </div>
  );
}

export function StepDetailPanel({
  stepId,
  processId,
  onClose,
}: {
  stepId: string;
  processId: string;
  onClose: () => void;
}): JSX.Element {
  const { t, locale } = useI18n();
  const { isEditor } = useAuth();
  const navigate = useNavigate();
  const { data: step, isLoading, isError, error, refetch } = useStepDetail(stepId);
  const { data: freshness } = useFreshness(processId);
  const { invalidateStep, invalidateProcess } = useInvalidators();
  const [mode, setMode] = useState<'read' | 'edit'>('read');
  const [showParty, setShowParty] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setMode('read');
  }, [stepId]);

  const stepFlags = (freshness?.flags ?? []).filter((f) => f.step_id === stepId);

  async function runAction(fn: () => Promise<{ step: StepDetail }>): Promise<void> {
    setActionError(null);
    try {
      await fn();
      invalidateStep(stepId);
      invalidateProcess(processId);
    } catch (err) {
      setActionError(errorMessage(err, t('error.save')));
    }
  }

  return (
    <aside
      className="absolute right-0 top-0 z-30 h-full w-full max-w-xl overflow-y-auto bg-doc-surface text-ink"
      style={{ boxShadow: '0 0 0 1px #0E1419, -8px 0 24px rgba(8,12,16,0.45)' }}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-doc-line bg-doc-surface px-5 py-3">
        <span className="text-xs uppercase tracking-label text-ink-muted">{t('nav.map')}</span>
        <button type="button" onClick={onClose} aria-label={t('common.close')} className="text-ink-muted hover:text-ink">
          ✕
        </button>
      </div>

      <div className="px-5 pb-10">
        {isLoading && <LoadingLine surface="doc" />}
        {isError && (
          <div className="py-4">
            <div className="flex items-center justify-between rounded-sm border border-status-red bg-status-red/5 px-4 py-3 text-sm text-status-red-doc">
              {errorMessage(error, t('error.load'))}
              <GhostButton surface="doc" onClick={() => void refetch()}>
                {t('common.retry')}
              </GhostButton>
            </div>
          </div>
        )}

        {step && mode === 'edit' && (
          <StepEditForm
            step={step}
            onCancel={() => setMode('read')}
            onSaved={() => {
              setMode('read');
              invalidateStep(stepId);
              invalidateProcess(processId);
            }}
          />
        )}

        {step && mode === 'read' && (
          <>
            {/* Header: sequence + title + 3 channel markers */}
            <div className="pt-4">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-xl tabular-nums">{step.sequence_index}</span>
                <h1 className="text-lg font-semibold leading-tight">
                  {pickBilingual(locale, step.title_es, step.title_en)}
                </h1>
              </div>
              {locale === 'en' && step.title_en && step.title_en !== step.title_es && (
                <div className="mt-1 text-2xs text-ink-muted">{step.title_es}</div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusStamp status={step.rag_status} surface="doc" />
                <ConfidenceTag confidence={step.confidence} surface="doc" />
                {step.classification === 'CRITICAL' && <CriticalChip surface="doc" />}
                {step.step_type && <Tag surface="doc">{step.step_type}</Tag>}
              </div>
            </div>

            {actionError && <div className="mt-3 rounded-sm border border-status-red bg-status-red/5 px-3 py-2 text-2xs text-status-red-doc">{actionError}</div>}

            {/* Editor action row */}
            {isEditor && (
              <div className="mt-3 flex flex-wrap gap-2">
                <GhostButton surface="doc" className="py-1 text-2xs" onClick={() => setMode('edit')}>
                  {t('common.edit')}
                </GhostButton>
                <GhostButton surface="doc" className="py-1 text-2xs" onClick={() => void runAction(() => stepApi.review(stepId))}>
                  {t('step.markReviewed')}
                </GhostButton>
                {step.confidence !== 'CONFIRMED' && (
                  <GhostButton surface="doc" className="py-1 text-2xs" onClick={() => void runAction(() => stepApi.confirm(stepId))}>
                    {t('step.markConfirmed')}
                  </GhostButton>
                )}
                <GhostButton surface="doc" className="py-1 text-2xs" onClick={() => navigate(`/process/${processId}/interview?step=${stepId}`)}>
                  {t('step.interview')}
                </GhostButton>
              </div>
            )}

            {/* Wiki fields */}
            <FieldBlock label={t('step.description')}>
              {(() => {
                const r = resolveBilingual(locale, step.description_es, step.description_en);
                return r.empty ? <GapChip>{t('common.none')}</GapChip> : <BilingualValue es={step.description_es} en={step.description_en} />;
              })()}
            </FieldBlock>
            {(step.trigger_es || step.trigger_en) && (
              <FieldBlock label={t('step.trigger')}>
                <BilingualValue es={step.trigger_es} en={step.trigger_en} />
              </FieldBlock>
            )}
            {(step.action_es || step.action_en) && (
              <FieldBlock label={t('step.action')}>
                <BilingualValue es={step.action_es} en={step.action_en} />
              </FieldBlock>
            )}
            {(step.reason_es || step.reason_en) && (
              <FieldBlock label={t('step.reason')}>
                <BilingualValue es={step.reason_es} en={step.reason_en} />
              </FieldBlock>
            )}

            {/* Inputs / Outputs */}
            <FieldBlock label={t('step.inputs')}>
              {step.inputs.length === 0 ? (
                <span className="text-ink-muted">{t('step.noInputs')}</span>
              ) : (
                <ul className="list-disc pl-5">
                  {step.inputs.map((io) => (
                    <li key={io.id}>
                      {pickBilingual(locale, io.name_es, io.name_en)} <Tag surface="doc">{io.kind}</Tag>
                    </li>
                  ))}
                </ul>
              )}
            </FieldBlock>
            <FieldBlock label={t('step.outputs')}>
              {step.outputs.length === 0 ? (
                <span className="text-ink-muted">{t('step.noOutputs')}</span>
              ) : (
                <ul className="list-disc pl-5">
                  {step.outputs.map((io) => (
                    <li key={io.id}>
                      {pickBilingual(locale, io.name_es, io.name_en)} <Tag surface="doc">{io.kind}</Tag>
                    </li>
                  ))}
                </ul>
              )}
            </FieldBlock>

            {/* Responsible party + contact */}
            <FieldBlock label={t('step.responsible')}>
              {step.responsible_party ? (
                <div className="space-y-1">
                  <div className="font-medium">{step.responsible_party.name}</div>
                  <div className="text-sm text-ink-muted">
                    {step.responsible_party.role ?? '—'} ·{' '}
                    {step.responsible_party.party_kind === 'external' ? t('step.external') : t('step.internal')}
                  </div>
                  <div className="text-sm">
                    {step.responsible_party.email ? (
                      <a className="text-accent-press underline" href={`mailto:${step.responsible_party.email}`}>
                        {step.responsible_party.email}
                      </a>
                    ) : (
                      <GapChip tone="amber">{t('step.missingEmail')}</GapChip>
                    )}
                  </div>
                  {step.responsible_party.organization && (
                    <div className="text-sm text-ink-muted">{step.responsible_party.organization}</div>
                  )}
                  {step.responsible_party.key_person_risk && (
                    <div>
                      <span className="inline-flex items-center gap-1 rounded-sm border border-status-amber px-2 py-[1px] text-2xs text-status-amber-doc">
                        {t('step.keyPersonRisk')}
                        {!step.responsible_party.backup_noted && ` · ${t('step.noBackup')}`}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <GapChip tone="amber">{t('step.noOwner')}</GapChip>
              )}
              {isEditor && (
                <div className="mt-2">
                  <GhostButton surface="doc" className="py-1 text-2xs" onClick={() => setShowParty(true)}>
                    {t('step.editParty')}
                  </GhostButton>
                </div>
              )}
            </FieldBlock>

            {/* Documents */}
            <FieldBlock label={t('step.documents')}>
              {step.documents.length === 0 ? (
                <span className="text-ink-muted">{t('step.noDocs')}</span>
              ) : (
                <ul className="space-y-2">
                  {step.documents.map((d) => (
                    <li key={`${d.document.id}-${d.role}`} className="flex items-center justify-between gap-2 rounded-sm border border-doc-line bg-doc-raised px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{d.document.name}</div>
                        <div className="text-2xs text-ink-muted">
                          <Tag surface="doc">{d.document.doc_type}</Tag> <Tag surface="doc">{d.document.format}</Tag>{' '}
                          {t(`step.docRole.${d.role}`)}
                          {' · '}
                          {pickBilingual(locale, d.document.canonical_term_es, d.document.canonical_term_en)}
                        </div>
                      </div>
                      <GhostButton surface="doc" className="py-1 text-2xs" onClick={() => setPreviewDocId(d.document.id)}>
                        {t('common.preview')}
                      </GhostButton>
                    </li>
                  ))}
                </ul>
              )}
              {isEditor && (
                <div className="mt-2">
                  <GhostButton surface="doc" className="py-1 text-2xs" onClick={() => setShowUpload(true)}>
                    {t('step.attachDoc')}
                  </GhostButton>
                </div>
              )}
            </FieldBlock>

            {/* Common issues */}
            {(step.common_issues_es || step.common_issues_en) && (
              <FieldBlock label={t('step.issues')}>
                <BilingualValue es={step.common_issues_es} en={step.common_issues_en} />
              </FieldBlock>
            )}

            {/* Handoffs out (branch/loop readable from the detail) */}
            <FieldBlock label={t('step.handoffsOut')}>
              {step.handoffs_out.length === 0 ? (
                <span className="text-ink-muted">{t('common.none')}</span>
              ) : (
                <ul className="space-y-1">
                  {step.handoffs_out.map((h) => (
                    <li key={h.id} className="flex items-center gap-2 text-sm">
                      <Tag surface="doc">{t(`map.edge.${h.kind}`)}</Tag>
                      {(h.condition_es || h.condition_en) && (
                        <span className="text-ink-muted">{pickBilingual(locale, h.condition_es, h.condition_en)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </FieldBlock>

            {/* Freshness nudges — non-binding; viewers see status only */}
            {stepFlags.length > 0 && (
              <FieldBlock label={t('step.freshness')}>
                {stepFlags.map((f, i) => (
                  <FreshnessNudge key={i} flag={f} stepId={stepId} processId={processId} canAct={isEditor} />
                ))}
              </FieldBlock>
            )}

            {/* Metadata */}
            <FieldBlock label={t('step.metadata')}>
              <div className="grid grid-cols-2 gap-2 text-sm text-ink-muted">
                <span>{t('step.lastReviewed')}: {step.last_reviewed_at ? formatDate(locale, step.last_reviewed_at) : t('step.never')}</span>
                <span>{t('step.lastEdited')}: {formatDate(locale, step.updated_at)}</span>
              </div>
            </FieldBlock>

            {isEditor && (
              <div className="mt-4 border-t border-doc-line pt-4">
                <button type="button" className="text-2xs text-status-red-doc underline" onClick={() => setConfirmDelete(true)}>
                  {t('common.delete')}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showParty && step && (
        <PartyPicker
          currentPartyId={step.responsible_party_id}
          onClose={() => setShowParty(false)}
          onPick={async (partyId) => {
            setShowParty(false);
            await runAction(() => stepApi.update(stepId, { responsible_party_id: partyId }));
          }}
        />
      )}
      {showUpload && step && (
        <DocumentUploadModal
          stepId={stepId}
          onClose={() => setShowUpload(false)}
          onAttached={() => {
            setShowUpload(false);
            invalidateStep(stepId);
            invalidateProcess(processId);
          }}
        />
      )}
      {previewDocId && <DocumentPreviewModal documentId={previewDocId} onClose={() => setPreviewDocId(null)} />}
      {confirmDelete && step && (
        <ConfirmDialog
          title={t('common.delete')}
          message={`${t('common.delete')}: ${pickBilingual(locale, step.title_es, step.title_en)}?`}
          confirmLabel={t('common.delete')}
          onConfirm={async () => {
            setConfirmDelete(false);
            await runAction(() => stepApi.archive(stepId));
            onClose();
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </aside>
  );
}

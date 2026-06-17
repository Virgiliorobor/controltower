// VIEW 6 — Draft Review (Revisar borrador) — THE AI→HUMAN SAVE GATE (D0-6 / DC-4). Renders the AI-produced
// draft (GET /interviews/:draftId) as an editable map+wiki preview, marked persistently "BORRADOR — sin
// guardar". The validator's coverage_gaps + confidence_flags are shown HONESTLY (blanked/flagged fields, never
// auto-filled — DC-5). The editor edits, then Saves.
//
// THE SAVE PATH IS THE EDITOR'S OWN whole-graph registry call (MAJ-01 fix):
//   POST /api/v1/processes/save-graph  — header + parties + io_items + ordered steps (with per-step owner) +
//   step_io + step_documents + handoffs, persisted atomically. This replaces the old piecemeal loop that
//   dropped parties / IO / documents / per-step responsible_party_id on every Save.
//
// The AI never calls this route. The draft is an ai-gateway artifact; the editor reviews/edits it HERE on the
// client and the resulting graph is posted to process-registry (the single writer) by a human action. This is
// the only place a draft becomes a published process. Hard-required to save: process.title_es present + every
// branch/loop handoff has a condition (the server re-validates and returns a clear 400 on a bad reference).

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';
import { aiApi, processApi } from '../lib/endpoints';
import type { SaveGraphBody, SaveGraphPartyBody, SaveGraphStepBody } from '../lib/endpoints';
import { useInvalidators, errorMessage } from '../lib/hooks';
import { StatusStamp, ConfidenceTag, CriticalChip } from '../components/channels';
import {
  ConfirmDialog,
  EmptyState,
  GapChip,
  GhostButton,
  LoadingLine,
  PrimaryButton,
  ProgressBar,
  Tag,
  TextArea,
  TextInput,
} from '../components/primitives';
import type {
  Confidence,
  DraftHandoff,
  DraftStep,
  ProcessDraftBody,
} from '../lib/types';

export default function DraftReviewView(): JSX.Element {
  const { t } = useI18n();
  const { draftId } = useParams();
  const navigate = useNavigate();
  const { invalidateAll } = useInvalidators();

  const [draft, setDraft] = useState<ProcessDraftBody | null>(null);
  const [gaps, setGaps] = useState<string[]>([]);
  const [flags, setFlags] = useState<{ field: string; reason: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    if (!draftId) return;
    let cancelled = false;
    setLoading(true);
    aiApi
      .getDraft(draftId)
      .then((res) => {
        if (cancelled) return;
        // The draft JSON may be partial/empty if the interview never assembled — normalize the shape so the
        // editor lands on a usable (if mostly-empty) review surface rather than a crash.
        const raw = (res.draft ?? {}) as Partial<ProcessDraftBody>;
        setDraft({
          process: raw.process ?? { title_es: '' },
          steps: Array.isArray(raw.steps) ? raw.steps : [],
          handoffs: Array.isArray(raw.handoffs) ? raw.handoffs : [],
          parties: raw.parties ?? [],
          io_items: raw.io_items ?? [],
          documents: raw.documents ?? [],
        });
        setGaps(res.coverage_gaps ?? []);
        setFlags(res.confidence_flags ?? []);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorMessage(err, t('error.load')));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draftId, t]);

  const orderedSteps = useMemo(
    () => (draft ? [...draft.steps].sort((a, b) => a.sequence_index - b.sequence_index) : []),
    [draft],
  );

  // Structural soundness: title_es present, ≥1 step, every branch/loop handoff carries a condition, no dangling
  // handoff target. Mirrors the server publish checks so Save isn't blocked by a surprise.
  const structural = useMemo(() => {
    if (!draft) return { valid: false, problems: [] as string[] };
    const problems: string[] = [];
    if (!draft.process.title_es?.trim()) problems.push(t('draft.titleEsBlocked'));
    if (draft.steps.length === 0) problems.push(t('form.atLeastOneStep'));
    const stepIds = new Set(draft.steps.map((s) => s.id));
    for (const h of draft.handoffs ?? []) {
      if (!stepIds.has(h.from_step_id) || !stepIds.has(h.to_step_id)) problems.push(`handoff ${h.id}`);
      if ((h.kind === 'branch' || h.kind === 'loop') && !h.condition?.trim()) problems.push(`condition ${h.id}`);
    }
    for (const s of draft.steps) if (!s.title_es?.trim()) problems.push(`title ${s.id}`);
    return { valid: problems.length === 0, problems };
  }, [draft, t]);

  function patchStep(id: string, patch: Partial<DraftStep>): void {
    setDraft((d) => (d ? { ...d, steps: d.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) } : d));
  }
  function patchHandoff(id: string, patch: Partial<DraftHandoff>): void {
    setDraft((d) => (d ? { ...d, handoffs: (d.handoffs ?? []).map((h) => (h.id === id ? { ...h, ...patch } : h)) } : d));
  }

  // THE HUMAN SAVE: assemble the WHOLE (edited) draft graph and persist it in ONE atomic registry call
  // (MAJ-01 fix). Parties, io_items, per-step responsible_party_id, step_io, step_documents and handoffs all
  // travel together — nothing is dropped. The AI is not in this path; this is the editor's call to the
  // single-writer registry. ref strings are the draft's own client-local ids; the server resolves them.
  async function save(): Promise<void> {
    if (!draft) return;
    setSaveError(null);
    if (!structural.valid) {
      setSaveError(t('draft.structureInvalid'));
      return;
    }
    setSaving(true);
    try {
      // Only carry io refs the draft actually defines, so a stray step input/output can't dangle.
      const ioRefs = new Set((draft.io_items ?? []).map((i) => i.id));
      const partyRefs = new Set((draft.parties ?? []).map((p) => p.id));

      const parties: SaveGraphPartyBody[] = (draft.parties ?? []).map((p) => ({
        ref: p.id,
        name: p.name,
        role: p.role ?? null,
        email: p.email ?? null,
        organization: p.organization ?? null,
        party_kind: p.party_kind,
        key_person_risk: p.key_person_risk ?? false,
        backup_noted: p.backup_noted ?? false,
        notes_es: p.notes ?? null,
      }));

      const steps: SaveGraphStepBody[] = orderedSteps.map((s, i) => ({
        ref: s.id,
        sequence_index: i + 1,
        title_es: s.title_es,
        title_en: s.title_en ?? null,
        description_es: s.description_es ?? null,
        action_es: s.action ?? null,
        trigger_es: s.trigger ?? null,
        reason_es: s.reason ?? null,
        common_issues_es: s.common_issues ?? null,
        step_type: s.step_type ?? null,
        classification: s.classification ?? null,
        confidence: s.confidence,
        responsible_party_ref: s.responsible_party_id && partyRefs.has(s.responsible_party_id) ? s.responsible_party_id : null,
        io: [
          ...(s.inputs ?? []).filter((r) => ioRefs.has(r)).map((r) => ({ io_ref: r, role: 'input' as const })),
          ...(s.outputs ?? []).filter((r) => ioRefs.has(r)).map((r) => ({ io_ref: r, role: 'output' as const })),
        ],
        documents: (s.documents ?? []).map((d) => ({ document_id: d.document_id, role: d.role })),
      }));

      const body: SaveGraphBody = {
        process: {
          title_es: draft.process.title_es,
          title_en: draft.process.title_en ?? null,
          description_es: draft.process.description_es ?? null,
          description_en: draft.process.description_en ?? null,
          domain: draft.process.domain ?? null,
        },
        parties,
        io_items: (draft.io_items ?? []).map((i) => ({
          ref: i.id,
          name_es: i.name,
          kind: i.kind,
          description_es: i.description ?? null,
        })),
        steps,
        handoffs: (draft.handoffs ?? []).map((h) => ({
          from_step_ref: h.from_step_id,
          to_step_ref: h.to_step_id,
          kind: h.kind,
          condition_es: h.condition ?? null,
        })),
        publish: true,
      };

      const { process } = await processApi.saveGraph(body);
      invalidateAll();
      navigate(`/process/${process.id}`);
    } catch (err) {
      setSaveError(errorMessage(err, t('error.save')));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-doc-bg p-8">
        <LoadingLine surface="doc" />
      </div>
    );
  }
  if (loadError || !draft) {
    return (
      <div className="bg-doc-bg p-8">
        <EmptyState surface="doc" message={loadError ?? t('error.load')} />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-48px)] bg-doc-bg">
      {/* Persistent BORRADOR plate — can never be mistaken for the published map. */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-status-amber bg-status-amber/15 px-6 py-2 text-2xs uppercase tracking-label text-status-amber">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden>◆</span>
          {t('draft.banner')}
        </span>
        <span className="normal-case text-ink-muted">{t('draft.aiNotice')}</span>
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-3">
        {/* Left: editable draft */}
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-sm border border-doc-line bg-doc-surface p-5 text-ink">
            <h1 className="text-lg font-semibold">{t('draft.title')}</h1>
            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="mb-1 block text-2xs uppercase tracking-label text-ink-muted">
                  {t('form.titleEs')} *
                </span>
                <TextInput
                  value={draft.process.title_es}
                  onChange={(e) => setDraft({ ...draft, process: { ...draft.process, title_es: e.target.value } })}
                />
                {!draft.process.title_es?.trim() && <span className="mt-1 block text-2xs text-status-red-doc">{t('draft.titleEsBlocked')}</span>}
              </label>
            </div>
          </div>

          <div className="rounded-sm border border-doc-line bg-doc-surface p-5 text-ink">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-label text-ink-muted">{t('draft.steps')}</h2>
            <div className="space-y-4">
              {orderedSteps.map((s) => (
                <div key={s.id} className="rounded-sm border border-doc-line bg-doc-raised p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-base tabular-nums">{s.sequence_index}</span>
                    <ConfidenceTag confidence={s.confidence} surface="doc" />
                    {s.classification === 'CRITICAL' && <CriticalChip surface="doc" />}
                    <select
                      value={s.confidence}
                      onChange={(e) => patchStep(s.id, { confidence: e.target.value as Confidence })}
                      className="ml-auto rounded-sm border border-doc-line bg-doc-surface px-2 py-1 text-2xs text-ink"
                    >
                      <option value="INFERRED">{t('confidence.inferred')}</option>
                      <option value="FLAGGED">{t('confidence.flagged')}</option>
                      <option value="CONFIRMED">{t('confidence.confirmed')}</option>
                    </select>
                  </div>
                  <TextInput value={s.title_es} onChange={(e) => patchStep(s.id, { title_es: e.target.value })} placeholder={t('form.titleEs')} />
                  {!s.title_es?.trim() && <span className="mt-1 block text-2xs text-status-red-doc">{t('form.titleEsRequired')}</span>}
                  <TextArea
                    className="mt-2"
                    value={s.action ?? ''}
                    onChange={(e) => patchStep(s.id, { action: e.target.value })}
                    placeholder={t('step.action')}
                  />
                  {!s.responsible_party_id && <div className="mt-2"><GapChip tone="amber">{t('step.noOwner')}</GapChip></div>}
                </div>
              ))}
            </div>
          </div>

          {(draft.handoffs?.length ?? 0) > 0 && (
            <div className="rounded-sm border border-doc-line bg-doc-surface p-5 text-ink">
              <h2 className="mb-3 text-xs font-medium uppercase tracking-label text-ink-muted">{t('draft.handoffs')}</h2>
              <ul className="space-y-2">
                {(draft.handoffs ?? []).map((h) => {
                  const needsCond = h.kind === 'branch' || h.kind === 'loop';
                  return (
                    <li key={h.id} className="rounded-sm border border-doc-line px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Tag surface="doc">{t(`map.edge.${h.kind}`)}</Tag>
                        <span className="text-2xs text-ink-muted">{h.from_step_id.slice(0, 4)} → {h.to_step_id.slice(0, 4)}</span>
                      </div>
                      {needsCond && (
                        <TextInput
                          className="mt-2"
                          value={h.condition ?? ''}
                          onChange={(e) => patchHandoff(h.id, { condition: e.target.value })}
                          placeholder="Condición *"
                        />
                      )}
                      {needsCond && !h.condition?.trim() && <span className="mt-1 block text-2xs text-status-red-doc">{t('draft.structureInvalid')}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Right: gaps + flags + structural soundness + Save */}
        <aside className="space-y-4">
          <div className="rounded-sm border border-doc-line bg-doc-surface p-4 text-ink">
            <div className="mb-2 text-xs font-medium uppercase tracking-label text-ink-muted">{t('draft.structureValid')}</div>
            {structural.valid ? (
              <StatusStamp status="green" surface="doc" />
            ) : (
              <div className="text-sm text-status-red-doc">{t('draft.structureInvalid')}</div>
            )}
          </div>

          <div className="rounded-sm border border-doc-line bg-doc-surface p-4 text-ink">
            <div className="mb-2 text-xs font-medium uppercase tracking-label text-ink-muted">{t('draft.coverageGaps')}</div>
            {gaps.length === 0 ? (
              <span className="text-sm text-ink-muted">{t('draft.noGaps')}</span>
            ) : (
              <ul className="space-y-1">
                {gaps.map((g, i) => (
                  <li key={i}>
                    <GapChip tone="amber">{g}</GapChip>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-sm border border-doc-line bg-doc-surface p-4 text-ink">
            <div className="mb-2 text-xs font-medium uppercase tracking-label text-ink-muted">{t('draft.confidenceFlags')}</div>
            {flags.length === 0 ? (
              <span className="text-sm text-ink-muted">{t('draft.noFlags')}</span>
            ) : (
              <ul className="space-y-2 text-2xs text-ink-muted">
                {flags.map((f, i) => (
                  <li key={i} className="rounded-sm border border-doc-line px-2 py-1">
                    <span className="font-mono">{f.field}</span> — {f.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {saveError && <div className="rounded-sm border border-status-red bg-status-red/5 px-3 py-2 text-2xs text-status-red-doc">{saveError}</div>}
          {saving && <ProgressBar label={t('draft.saving')} />}

          <div className="space-y-2">
            <PrimaryButton className="w-full" onClick={() => void save()} disabled={saving || !structural.valid}>
              {t('draft.save')}
            </PrimaryButton>
            {draftId && (
              <GhostButton surface="doc" className="w-full" onClick={() => navigate('/create/interview')}>
                {t('draft.backToInterview')}
              </GhostButton>
            )}
            <button type="button" className="block w-full text-center text-2xs text-status-red-doc underline" onClick={() => setConfirmDiscard(true)}>
              {t('draft.discard')}
            </button>
          </div>
        </aside>
      </div>

      {confirmDiscard && (
        <ConfirmDialog
          title={t('draft.discard')}
          message={t('draft.discard')}
          confirmLabel={t('common.discard')}
          onConfirm={() => navigate('/')}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </div>
  );
}

// VIEW 4 — Create Process via Form (Crear proceso — formulario). The deterministic, non-AI capture path
// (FLOW 1). Editor/Admin only. Process header + a steps builder (with inline responsible party) + a
// connections builder. On Save it posts the WHOLE graph in ONE atomic registry call (MAJ-02 fix):
//   POST /api/v1/processes/save-graph — header + responsible_parties + ordered steps (with per-step owner) +
//   handoffs, optionally published. This replaces the old piecemeal loop that dropped the per-step owner and
//   could not carry parties at all.
// Validation mirrors the Draft Validator surface (title_es required; ≥1 step; branch/loop has a condition).
// (IO items + document attachment remain post-create actions in the Step Detail panel — see dev_record.)

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';
import { processApi } from '../lib/endpoints';
import type { SaveGraphBody, SaveGraphPartyBody } from '../lib/endpoints';
import { useInvalidators, errorMessage } from '../lib/hooks';
import { Field, GhostButton, PrimaryButton, ProgressBar, Select, TextArea, TextInput } from '../components/primitives';
import { HANDOFF_KINDS, STEP_TYPES, type HandoffKind, type StepType } from '../lib/types';

interface StepRow {
  title_es: string;
  title_en: string;
  description_es: string;
  action_es: string;
  step_type: StepType | '';
  // Inline responsible party (VIEW 4). Captured per step; deduped into the parties graph on Save so a step
  // never lands ownerless (the gap MAJ-02 reported). Left blank → the step is honestly unowned (a RAG gap),
  // never an invented owner.
  owner_name: string;
  owner_email: string;
  owner_role: string;
}
interface ConnRow {
  fromIdx: number;
  toIdx: number;
  kind: HandoffKind;
  condition_es: string;
  condition_en: string;
}

const emptyStep = (): StepRow => ({
  title_es: '',
  title_en: '',
  description_es: '',
  action_es: '',
  step_type: '',
  owner_name: '',
  owner_email: '',
  owner_role: '',
});

export default function FormCreateView(): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { invalidateAll } = useInvalidators();
  const [header, setHeader] = useState({ title_es: '', title_en: '', description_es: '', domain: 'IMMEX import MX←US' });
  const [steps, setSteps] = useState<StepRow[]>([emptyStep()]);
  const [conns, setConns] = useState<ConnRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [titleErr, setTitleErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function updateStep(i: number, patch: Partial<StepRow>): void {
    setSteps((s) => s.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function updateConn(i: number, patch: Partial<ConnRow>): void {
    setConns((c) => c.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function save(publish: boolean): Promise<void> {
    setError(null);
    setTitleErr(null);
    if (!header.title_es.trim()) {
      setTitleErr(t('form.titleEsRequired'));
      return;
    }
    const validSteps = steps.filter((s) => s.title_es.trim());
    if (validSteps.length === 0) {
      setError(t('form.atLeastOneStep'));
      return;
    }
    for (const c of conns) {
      if ((c.kind === 'branch' || c.kind === 'loop') && !c.condition_es.trim()) {
        setError(t('error.generic'));
        return;
      }
    }
    setBusy(true);
    try {
      // Assemble the WHOLE graph and persist it atomically via the single-writer registry (MAJ-02 fix).
      // ref strings wire steps→parties and handoffs→steps; the server resolves them inside one transaction.
      // Parties are deduped within this form by a name+email key, so two steps sharing an owner reuse one party.
      const parties: SaveGraphPartyBody[] = [];
      const partyRefByKey = new Map<string, string>();
      const ownerRefFor = (s: StepRow): string | null => {
        const name = s.owner_name.trim();
        if (!name) return null;
        const email = s.owner_email.trim();
        const key = `${name.toLowerCase()}|${email.toLowerCase()}`;
        const existing = partyRefByKey.get(key);
        if (existing) return existing;
        const ref = `party-${parties.length}`;
        partyRefByKey.set(key, ref);
        parties.push({
          ref,
          name,
          email: email || null,
          role: s.owner_role.trim() || null,
          party_kind: 'internal_editor',
        });
        return ref;
      };

      // Only rows with a title become steps; keep a row→ref map so connections resolve to the right step.
      const refByIdx: (string | null)[] = [];
      const graphSteps: SaveGraphBody['steps'] = [];
      let seq = 0;
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        if (!s || !s.title_es.trim()) {
          refByIdx[i] = null;
          continue;
        }
        seq += 1;
        const ref = `step-${i}`;
        refByIdx[i] = ref;
        graphSteps.push({
          ref,
          sequence_index: seq,
          title_es: s.title_es,
          title_en: s.title_en || null,
          description_es: s.description_es || null,
          action_es: s.action_es || null,
          step_type: (s.step_type || null) as StepType | null,
          responsible_party_ref: ownerRefFor(s),
        });
      }

      const handoffs: SaveGraphBody['handoffs'] = [];
      for (const c of conns) {
        const fromRef = refByIdx[c.fromIdx];
        const toRef = refByIdx[c.toIdx];
        if (!fromRef || !toRef) continue;
        handoffs.push({
          from_step_ref: fromRef,
          to_step_ref: toRef,
          kind: c.kind,
          condition_es: c.condition_es || null,
          condition_en: c.condition_en || null,
        });
      }

      const body: SaveGraphBody = {
        process: {
          title_es: header.title_es,
          title_en: header.title_en || null,
          description_es: header.description_es || null,
          domain: header.domain || null,
        },
        parties,
        steps: graphSteps,
        handoffs,
        publish,
      };

      const { process } = await processApi.saveGraph(body);
      invalidateAll();
      navigate(`/process/${process.id}`);
    } catch (err) {
      setError(errorMessage(err, t('error.save')));
    } finally {
      setBusy(false);
    }
  }

  const stepOptions = steps.map((s, i) => ({ idx: i, label: `${i + 1}. ${s.title_es || t('form.step')}` }));

  return (
    <div className="min-h-[calc(100vh-48px)] bg-doc-bg">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="rounded-sm border border-doc-line bg-doc-surface p-6 text-ink">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-xl font-semibold">{t('create.form')}</h1>
            <GhostButton surface="doc" onClick={() => navigate('/create')}>
              {t('common.back')}
            </GhostButton>
          </div>

          {/* Header */}
          <section className="space-y-4">
            <h2 className="text-xs font-medium uppercase tracking-label text-ink-muted">{t('form.processHeader')}</h2>
            <Field label={t('form.titleEs')} required error={titleErr}>
              <TextInput value={header.title_es} onChange={(e) => setHeader({ ...header, title_es: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('form.titleEn')}>
                <TextInput value={header.title_en} onChange={(e) => setHeader({ ...header, title_en: e.target.value })} />
              </Field>
              <Field label={t('form.domain')}>
                <TextInput value={header.domain} onChange={(e) => setHeader({ ...header, domain: e.target.value })} />
              </Field>
            </div>
            <Field label={t('form.descEs')}>
              <TextArea value={header.description_es} onChange={(e) => setHeader({ ...header, description_es: e.target.value })} />
            </Field>
          </section>

          {/* Steps */}
          <section className="mt-6 border-t border-doc-line pt-6">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-label text-ink-muted">{t('form.steps')}</h2>
            <div className="space-y-4">
              {steps.map((s, i) => (
                <div key={i} className="rounded-sm border border-doc-line bg-doc-raised p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-mono text-sm tabular-nums">{t('form.step')} {i + 1}</span>
                    {steps.length > 1 && (
                      <button type="button" className="text-2xs text-status-red-doc underline" onClick={() => setSteps((arr) => arr.filter((_, idx) => idx !== i))}>
                        {t('common.remove')}
                      </button>
                    )}
                  </div>
                  <div className="grid gap-3">
                    <Field label={t('form.titleEs')} required>
                      <TextInput value={s.title_es} onChange={(e) => updateStep(i, { title_es: e.target.value })} />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={t('form.titleEn')}>
                        <TextInput value={s.title_en} onChange={(e) => updateStep(i, { title_en: e.target.value })} />
                      </Field>
                      <Field label={t('step.stepType')}>
                        <Select value={s.step_type} onChange={(e) => updateStep(i, { step_type: e.target.value as StepType | '' })}>
                          <option value="">—</option>
                          {STEP_TYPES.map((st) => (
                            <option key={st} value={st}>
                              {st}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <Field label={t('step.action')}>
                      <TextArea value={s.action_es} onChange={(e) => updateStep(i, { action_es: e.target.value })} />
                    </Field>
                    {/* Inline responsible party (VIEW 4 / MAJ-02). Persisted as the step's owner on Save. */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <Field label={t('form.ownerName')}>
                        <TextInput value={s.owner_name} onChange={(e) => updateStep(i, { owner_name: e.target.value })} />
                      </Field>
                      <Field label={t('form.ownerEmail')}>
                        <TextInput value={s.owner_email} onChange={(e) => updateStep(i, { owner_email: e.target.value })} />
                      </Field>
                      <Field label={t('form.ownerRole')}>
                        <TextInput value={s.owner_role} onChange={(e) => updateStep(i, { owner_role: e.target.value })} />
                      </Field>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <GhostButton surface="doc" className="mt-3" onClick={() => setSteps((arr) => [...arr, emptyStep()])}>
              {t('form.addStep')}
            </GhostButton>
          </section>

          {/* Connections */}
          <section className="mt-6 border-t border-doc-line pt-6">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-label text-ink-muted">{t('draft.handoffs')}</h2>
            <div className="space-y-3">
              {conns.map((c, i) => {
                const needsCond = c.kind === 'branch' || c.kind === 'loop';
                return (
                  <div key={i} className="rounded-sm border border-doc-line p-3">
                    <div className="grid grid-cols-3 gap-2">
                      <Select value={c.fromIdx} onChange={(e) => updateConn(i, { fromIdx: Number(e.target.value) })}>
                        {stepOptions.map((o) => (
                          <option key={o.idx} value={o.idx}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                      <Select value={c.toIdx} onChange={(e) => updateConn(i, { toIdx: Number(e.target.value) })}>
                        {stepOptions.map((o) => (
                          <option key={o.idx} value={o.idx}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                      <Select value={c.kind} onChange={(e) => updateConn(i, { kind: e.target.value as HandoffKind })}>
                        {HANDOFF_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {t(`map.edge.${k}`)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    {needsCond && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <TextInput placeholder="Condición (ES) *" value={c.condition_es} onChange={(e) => updateConn(i, { condition_es: e.target.value })} />
                        <TextInput placeholder="Condition (EN)" value={c.condition_en} onChange={(e) => updateConn(i, { condition_en: e.target.value })} />
                      </div>
                    )}
                    <button type="button" className="mt-2 text-2xs text-status-red-doc underline" onClick={() => setConns((arr) => arr.filter((_, idx) => idx !== i))}>
                      {t('common.remove')}
                    </button>
                  </div>
                );
              })}
            </div>
            <GhostButton
              surface="doc"
              className="mt-3"
              onClick={() => setConns((arr) => [...arr, { fromIdx: 0, toIdx: Math.min(1, steps.length - 1), kind: 'sequential', condition_es: '', condition_en: '' }])}
            >
              {t('common.add')}
            </GhostButton>
          </section>

          {error && <div className="mt-4 rounded-sm border border-status-red bg-status-red/5 px-3 py-2 text-sm text-status-red-doc">{error}</div>}
          {busy && <div className="mt-4"><ProgressBar label={t('form.creating')} /></div>}

          <div className="mt-6 flex justify-end gap-2 border-t border-doc-line pt-4">
            <GhostButton surface="doc" onClick={() => void save(false)} disabled={busy}>
              {t('form.saveDraft')}
            </GhostButton>
            <PrimaryButton onClick={() => void save(true)} disabled={busy}>
              {t('form.savePublish')}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

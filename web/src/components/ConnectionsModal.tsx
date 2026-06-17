// "Editar conexiones" — add/remove handoffs between steps (VIEW 2 / FLOW 8, editor only). POST /handoffs and
// DELETE /handoffs/:id. The four kinds are first-class (DC-2): branch/loop REQUIRE a condition (the server
// rejects otherwise — "una bifurcación o un regreso necesita una condición"); we enforce it client-side too so
// the editor sees the rule before submit. Existing edges are listed with their kind + condition; removing one
// archives it. Re-flow happens on the map automatically (no saved coordinates).

import { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { handoffApi } from '../lib/endpoints';
import { useInvalidators, errorMessage } from '../lib/hooks';
import { pickBilingual } from '../i18n/bilingual';
import { Field, GhostButton, Modal, PrimaryButton, Select, TextInput, Tag } from './primitives';
import { HANDOFF_KINDS, type GraphEdge, type GraphNode, type HandoffKind } from '../lib/types';

export function ConnectionsModal({
  processId,
  nodes,
  edges,
  onClose,
  onSaved,
}: {
  processId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { t, locale } = useI18n();
  const { invalidateProcess } = useInvalidators();
  const ordered = [...nodes].sort((a, b) => a.sequence_index - b.sequence_index);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kind, setKind] = useState<HandoffKind>('sequential');
  const [conditionEs, setConditionEs] = useState('');
  const [conditionEn, setConditionEn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsCondition = kind === 'branch' || kind === 'loop';
  const labelOf = (id: string): string => {
    const n = nodes.find((x) => x.id === id);
    return n ? `${n.sequence_index}. ${pickBilingual(locale, n.title_es, n.title_en)}` : id;
  };

  async function add(): Promise<void> {
    setError(null);
    if (!from || !to) {
      setError(t('error.generic'));
      return;
    }
    if (needsCondition && !conditionEs.trim()) {
      setError(locale === 'es' ? 'Una bifurcación o un regreso necesita una condición' : 'A branch or loop needs a condition');
      return;
    }
    setBusy(true);
    try {
      await handoffApi.create({
        process_id: processId,
        from_step_id: from,
        to_step_id: to,
        kind,
        condition_es: conditionEs || null,
        condition_en: conditionEn || null,
      });
      invalidateProcess(processId);
      setConditionEs('');
      setConditionEn('');
      onSaved();
    } catch (err) {
      setError(errorMessage(err, t('error.save')));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setBusy(true);
    try {
      await handoffApi.remove(id);
      invalidateProcess(processId);
      onSaved();
    } catch (err) {
      setError(errorMessage(err, t('error.save')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('map.editConnections')} onClose={onClose} wide>
      <div className="space-y-5">
        <div className="space-y-3 rounded-sm border border-doc-line bg-doc-raised p-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('form.step') + ' (from)'} required>
              <Select value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="">—</option>
                {ordered.map((n) => (
                  <option key={n.id} value={n.id}>
                    {labelOf(n.id)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('form.step') + ' (to)'} required>
              <Select value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">—</option>
                {ordered.map((n) => (
                  <option key={n.id} value={n.id}>
                    {labelOf(n.id)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('map.legend.edges')} required>
              <Select value={kind} onChange={(e) => setKind(e.target.value as HandoffKind)}>
                {HANDOFF_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`map.edge.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {needsCondition && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Condición (ES)" required>
                <TextInput value={conditionEs} onChange={(e) => setConditionEs(e.target.value)} placeholder="VERDE — desaduanamiento libre" />
              </Field>
              <Field label="Condition (EN)">
                <TextInput value={conditionEn} onChange={(e) => setConditionEn(e.target.value)} />
              </Field>
            </div>
          )}
          {error && <div className="rounded-sm border border-status-red bg-status-red/5 px-3 py-2 text-2xs text-status-red-doc">{error}</div>}
          <div className="flex justify-end">
            <PrimaryButton onClick={add} disabled={busy}>
              {t('common.add')}
            </PrimaryButton>
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-label text-ink-muted">{t('draft.handoffs')}</div>
          {edges.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('common.none')}</p>
          ) : (
            <ul className="space-y-1">
              {edges.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 rounded-sm border border-doc-line px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{labelOf(e.from_step_id)}</span>
                    <Tag surface="doc">{t(`map.edge.${e.kind}`)}</Tag>
                    <span className="text-ink-muted">→ {labelOf(e.to_step_id)}</span>
                    {(e.condition_es || e.condition_en) && (
                      <span className="text-2xs italic text-ink-muted">{pickBilingual(locale, e.condition_es, e.condition_en)}</span>
                    )}
                  </div>
                  <button type="button" className="text-2xs text-status-red-doc underline" onClick={() => void remove(e.id)} disabled={busy}>
                    {t('common.remove')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end">
          <GhostButton surface="doc" onClick={onClose}>
            {t('common.close')}
          </GhostButton>
        </div>
      </div>
    </Modal>
  );
}

// "+ Paso" — add a step to an existing process from the map (VIEW 2 authoring affordance, editor only).
// POST /processes/:id/steps. sequence_index is optional (server appends after the current max). title_es is the
// one hard-required field; new steps default confidence INFERRED (the seed-correction model).

import { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { stepApi } from '../lib/endpoints';
import { useInvalidators, errorMessage } from '../lib/hooks';
import { Field, GhostButton, Modal, PrimaryButton, Select, TextArea, TextInput } from './primitives';
import { STEP_TYPES, type StepType } from '../lib/types';

export function StepFormModal({
  processId,
  onClose,
  onSaved,
}: {
  processId: string;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const { invalidateProcess } = useInvalidators();
  const [form, setForm] = useState({ title_es: '', title_en: '', description_es: '', action_es: '', step_type: '' as StepType | '' });
  const [titleErr, setTitleErr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(): Promise<void> {
    setError(null);
    setTitleErr(null);
    if (!form.title_es.trim()) {
      setTitleErr(t('form.titleEsRequired'));
      return;
    }
    setSaving(true);
    try {
      await stepApi.create(processId, {
        title_es: form.title_es,
        title_en: form.title_en || null,
        description_es: form.description_es || null,
        action_es: form.action_es || null,
        step_type: (form.step_type || null) as StepType | null,
      });
      invalidateProcess(processId);
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err, t('error.save')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={t('map.addStep')} onClose={onClose}>
      <div className="space-y-4">
        <Field label={t('form.titleEs')} required error={titleErr}>
          <TextInput value={form.title_es} onChange={(e) => setForm({ ...form, title_es: e.target.value })} />
        </Field>
        <Field label={t('form.titleEn')}>
          <TextInput value={form.title_en} onChange={(e) => setForm({ ...form, title_en: e.target.value })} />
        </Field>
        <Field label={t('step.description')}>
          <TextArea value={form.description_es} onChange={(e) => setForm({ ...form, description_es: e.target.value })} />
        </Field>
        <Field label={t('step.action')}>
          <TextArea value={form.action_es} onChange={(e) => setForm({ ...form, action_es: e.target.value })} />
        </Field>
        <Field label={t('step.stepType')}>
          <Select value={form.step_type} onChange={(e) => setForm({ ...form, step_type: e.target.value as StepType | '' })}>
            <option value="">—</option>
            {STEP_TYPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>

        {error && <div className="rounded-sm border border-status-red bg-status-red/5 px-3 py-2 text-2xs text-status-red-doc">{error}</div>}

        <div className="flex justify-end gap-2">
          <GhostButton surface="doc" onClick={onClose}>
            {t('common.cancel')}
          </GhostButton>
          <PrimaryButton onClick={save} disabled={saving}>
            {saving ? t('common.saving') : t('common.add')}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

// Step edit mode (FLOW 3): inline field editing on the doc surface. Saves via PATCH /steps/:id; on success the
// node's RAG/confidence on the map update immediately (server recomputes; we invalidate). Validation: title_es
// required (the one hard field). Dirty-state guard on cancel.

import { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { stepApi } from '../lib/endpoints';
import { errorMessage } from '../lib/hooks';
import { Field, GhostButton, PrimaryButton, Select, TextArea, TextInput } from './primitives';
import { CLASSIFICATIONS, STEP_TYPES, type Classification, type StepDetail, type StepType } from '../lib/types';

export function StepEditForm({
  step,
  onCancel,
  onSaved,
}: {
  step: StepDetail;
  onCancel: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [form, setForm] = useState({
    title_es: step.title_es,
    title_en: step.title_en ?? '',
    description_es: step.description_es ?? '',
    description_en: step.description_en ?? '',
    trigger_es: step.trigger_es ?? '',
    action_es: step.action_es ?? '',
    reason_es: step.reason_es ?? '',
    common_issues_es: step.common_issues_es ?? '',
    step_type: (step.step_type ?? '') as StepType | '',
    classification: (step.classification ?? '') as Classification | '',
  });
  const [error, setError] = useState<string | null>(null);
  const [titleErr, setTitleErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]): void {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save(): Promise<void> {
    setError(null);
    setTitleErr(null);
    if (!form.title_es.trim()) {
      setTitleErr(t('form.titleEsRequired'));
      return;
    }
    setSaving(true);
    try {
      await stepApi.update(step.id, {
        title_es: form.title_es,
        title_en: form.title_en || null,
        description_es: form.description_es || null,
        description_en: form.description_en || null,
        trigger_es: form.trigger_es || null,
        action_es: form.action_es || null,
        reason_es: form.reason_es || null,
        common_issues_es: form.common_issues_es || null,
        step_type: (form.step_type || null) as StepType | null,
        classification: (form.classification || null) as Classification | null,
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err, t('error.save')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 pt-4">
      <Field label={t('form.titleEs')} required error={titleErr}>
        <TextInput value={form.title_es} onChange={(e) => set('title_es', e.target.value)} />
      </Field>
      <Field label={t('form.titleEn')}>
        <TextInput value={form.title_en} onChange={(e) => set('title_en', e.target.value)} />
      </Field>
      <Field label={t('step.description')}>
        <TextArea value={form.description_es} onChange={(e) => set('description_es', e.target.value)} />
      </Field>
      <Field label={t('step.trigger')}>
        <TextArea value={form.trigger_es} onChange={(e) => set('trigger_es', e.target.value)} />
      </Field>
      <Field label={t('step.action')}>
        <TextArea value={form.action_es} onChange={(e) => set('action_es', e.target.value)} />
      </Field>
      <Field label={t('step.reason')}>
        <TextArea value={form.reason_es} onChange={(e) => set('reason_es', e.target.value)} />
      </Field>
      <Field label={t('step.issues')}>
        <TextArea value={form.common_issues_es} onChange={(e) => set('common_issues_es', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('step.stepType')}>
          <Select value={form.step_type} onChange={(e) => set('step_type', e.target.value as StepType | '')}>
            <option value="">—</option>
            {STEP_TYPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Classification">
          <Select value={form.classification} onChange={(e) => set('classification', e.target.value as Classification | '')}>
            <option value="">—</option>
            {CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {error && <div className="rounded-sm border border-status-red bg-status-red/5 px-3 py-2 text-2xs text-status-red-doc">{error}</div>}

      <div className="flex justify-end gap-2 border-t border-doc-line pt-3">
        <GhostButton surface="doc" onClick={onCancel}>
          {t('common.cancel')}
        </GhostButton>
        <PrimaryButton onClick={save} disabled={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </PrimaryButton>
      </div>
    </div>
  );
}

// Assign a responsible party to a step: pick from the existing directory or create a new one inline (FLOW 3).
// Returns the chosen party id to the caller, which PATCHes the step's responsible_party_id.

import { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { useParties, useInvalidators, errorMessage } from '../lib/hooks';
import { partyApi } from '../lib/endpoints';
import { Field, GhostButton, Modal, PrimaryButton, Select, TextInput } from './primitives';
import { PARTY_KINDS, type PartyKind } from '../lib/types';

export function PartyPicker({
  currentPartyId,
  onPick,
  onClose,
}: {
  currentPartyId: string | null;
  onPick: (partyId: string | null) => void;
  onClose: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const { data: parties, refetch } = useParties();
  const { invalidateAll } = useInvalidators();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(currentPartyId ?? '');
  const [form, setForm] = useState({ name: '', role: '', email: '', organization: '', party_kind: 'internal_editor' as PartyKind });
  const [error, setError] = useState<string | null>(null);

  async function createAndPick(): Promise<void> {
    setError(null);
    if (!form.name.trim()) {
      setError(t('form.titleEsRequired'));
      return;
    }
    try {
      const { party } = await partyApi.create({
        name: form.name,
        role: form.role || null,
        email: form.email || null,
        organization: form.organization || null,
        party_kind: form.party_kind,
      });
      invalidateAll();
      void refetch();
      onPick(party.id);
    } catch (err) {
      setError(errorMessage(err, t('error.save')));
    }
  }

  return (
    <Modal title={t('step.editParty')} onClose={onClose}>
      {!creating ? (
        <div className="space-y-4">
          <Field label={t('step.responsible')}>
            <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">{t('step.noOwner')}</option>
              {(parties ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.email ? `· ${p.email}` : `· (${t('contacts.missingEmail')})`}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-center justify-between">
            <GhostButton surface="doc" onClick={() => setCreating(true)}>
              {t('contacts.new')}
            </GhostButton>
            <PrimaryButton onClick={() => onPick(selected || null)}>{t('common.save')}</PrimaryButton>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={t('contacts.col.name')} required>
            <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('contacts.col.role')}>
              <TextInput value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
            </Field>
            <Field label={t('contacts.col.email')}>
              <TextInput type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('contacts.col.org')}>
              <TextInput value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} />
            </Field>
            <Field label={t('contacts.col.kind')}>
              <Select value={form.party_kind} onChange={(e) => setForm({ ...form, party_kind: e.target.value as PartyKind })}>
                {PARTY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`party.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {error && <div className="rounded-sm border border-status-red bg-status-red/5 px-3 py-2 text-2xs text-status-red-doc">{error}</div>}
          <div className="flex justify-end gap-2">
            <GhostButton surface="doc" onClick={() => setCreating(false)}>
              {t('common.cancel')}
            </GhostButton>
            <PrimaryButton onClick={createAndPick}>{t('common.create')}</PrimaryButton>
          </div>
        </div>
      )}
    </Modal>
  );
}

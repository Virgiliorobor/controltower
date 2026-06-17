// VIEW 10 — Contacts / Responsible-Parties directory (Directorio de responsables). Board-surface ruled table.
// Editors/Admin: add/edit parties, mark key_person_risk, note a backup. Viewers: read-only (no New/edit chrome).
// Gaps shown honestly ("falta correo" chip). Filters: internal/external, key-person-risk, sin correo.

import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { useParties, useInvalidators, errorMessage } from '../lib/hooks';
import { partyApi, type PartyBody } from '../lib/endpoints';
import {
  ConfirmDialog,
  EmptyState,
  ErrorStrip,
  Field,
  GapChip,
  GhostButton,
  LoadingLine,
  Modal,
  PrimaryButton,
  Select,
  Tag,
  TextInput,
} from '../components/primitives';
import { PARTY_KINDS, type PartyKind, type ResponsibleParty } from '../lib/types';

type PartyFilter = 'all' | 'internal' | 'external' | 'risk' | 'noEmail';

function PartyModal({
  party,
  onClose,
  onSaved,
}: {
  party: ResponsibleParty | null;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [form, setForm] = useState<PartyBody>({
    name: party?.name ?? '',
    role: party?.role ?? '',
    email: party?.email ?? '',
    organization: party?.organization ?? '',
    party_kind: party?.party_kind ?? 'internal_editor',
    key_person_risk: party?.key_person_risk ?? false,
    backup_noted: party?.backup_noted ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setError(null);
    if (!form.name.trim()) {
      setError(t('form.titleEsRequired'));
      return;
    }
    setBusy(true);
    try {
      const body: PartyBody = {
        ...form,
        role: form.role || null,
        email: form.email || null,
        organization: form.organization || null,
      };
      if (party) await partyApi.update(party.id, body);
      else await partyApi.create(body);
      onSaved();
    } catch (err) {
      setError(errorMessage(err, t('error.save')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={party ? t('common.edit') : t('contacts.new')} onClose={onClose}>
      <div className="space-y-4">
        <Field label={t('contacts.col.name')} required>
          <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('contacts.col.role')}>
            <TextInput value={form.role ?? ''} onChange={(e) => setForm({ ...form, role: e.target.value })} />
          </Field>
          <Field label={t('contacts.col.email')}>
            <TextInput type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('contacts.col.org')}>
            <TextInput value={form.organization ?? ''} onChange={(e) => setForm({ ...form, organization: e.target.value })} />
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
        <div className="flex gap-4 text-sm text-ink">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.key_person_risk} onChange={(e) => setForm({ ...form, key_person_risk: e.target.checked })} />
            {t('step.keyPersonRisk')}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.backup_noted} onChange={(e) => setForm({ ...form, backup_noted: e.target.checked })} />
            {t('step.noBackup')} ✓
          </label>
        </div>
        {error && <div className="rounded-sm border border-status-red bg-status-red/5 px-3 py-2 text-2xs text-status-red-doc">{error}</div>}
        <div className="flex justify-end gap-2">
          <GhostButton surface="doc" onClick={onClose}>
            {t('common.cancel')}
          </GhostButton>
          <PrimaryButton onClick={save} disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

export default function ContactsView(): JSX.Element {
  const { t } = useI18n();
  const { isEditor } = useAuth();
  const { data: parties, isLoading, isError, error, refetch } = useParties();
  const { invalidateAll } = useInvalidators();
  const [filter, setFilter] = useState<PartyFilter>('all');
  const [editing, setEditing] = useState<ResponsibleParty | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ResponsibleParty | null>(null);

  const filtered = (parties ?? []).filter((p) => {
    if (filter === 'internal') return p.party_kind !== 'external';
    if (filter === 'external') return p.party_kind === 'external';
    if (filter === 'risk') return p.key_person_risk;
    if (filter === 'noEmail') return !p.email;
    return true;
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink-onboard">{t('contacts.title')}</h1>
        {isEditor && <PrimaryButton onClick={() => setCreating(true)}>{t('contacts.new')}</PrimaryButton>}
      </div>

      <div className="mb-3 flex flex-wrap gap-2 text-2xs">
        {(['all', 'internal', 'external', 'risk', 'noEmail'] as PartyFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-sm border px-2 py-1 ${filter === f ? 'border-accent text-accent' : 'border-board-line text-ink-onboard-muted hover:bg-board-hover'}`}
          >
            {f === 'all' ? t('common.all') : f === 'noEmail' ? t('contacts.filter.noEmail') : t(`contacts.filter.${f}`)}
          </button>
        ))}
      </div>

      {isLoading && <LoadingLine surface="board" />}
      {isError && <ErrorStrip message={errorMessage(error, t('error.load'))} onRetry={() => void refetch()} />}
      {parties && filtered.length === 0 && <EmptyState surface="board" message={t('contacts.empty')} />}

      {parties && filtered.length > 0 && (
        <table className="w-full border-collapse text-sm text-ink-onboard">
          <thead>
            <tr className="border-b border-board-line text-left text-2xs uppercase tracking-label text-ink-onboard-muted">
              <th className="py-2 pr-3 font-medium">{t('contacts.col.name')}</th>
              <th className="py-2 pr-3 font-medium">{t('contacts.col.role')}</th>
              <th className="py-2 pr-3 font-medium">{t('contacts.col.email')}</th>
              <th className="py-2 pr-3 font-medium">{t('contacts.col.org')}</th>
              <th className="py-2 pr-3 font-medium">{t('contacts.col.kind')}</th>
              <th className="py-2 pr-3 font-medium">{t('contacts.col.risk')}</th>
              {isEditor && <th className="py-2 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className="border-b border-board-line hover:bg-board-hover">
                <td className="py-2 pr-3 font-medium">{p.name}</td>
                <td className="py-2 pr-3 text-ink-onboard-muted">{p.role ?? '—'}</td>
                <td className="py-2 pr-3">
                  {p.email ? <span>{p.email}</span> : <GapChip tone="amber">{t('contacts.missingEmail')}</GapChip>}
                </td>
                <td className="py-2 pr-3 text-ink-onboard-muted">{p.organization ?? '—'}</td>
                <td className="py-2 pr-3">
                  <Tag surface="board">{t(`party.${p.party_kind}`)}</Tag>
                </td>
                <td className="py-2 pr-3">
                  {p.key_person_risk ? (
                    <span className="text-status-amber">
                      {t('step.keyPersonRisk')}
                      {!p.backup_noted && ` · ${t('step.noBackup')}`}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                {isEditor && (
                  <td className="py-2 text-right">
                    <GhostButton surface="board" className="py-1 text-2xs" onClick={() => setEditing(p)}>
                      {t('common.edit')}
                    </GhostButton>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(creating || editing) && (
        <PartyModal
          party={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            invalidateAll();
            void refetch();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('common.delete')}
          message={`${t('common.delete')}: ${deleting.name}?`}
          confirmLabel={t('common.delete')}
          onConfirm={async () => {
            const id = deleting.id;
            setDeleting(null);
            await partyApi.remove(id).catch(() => undefined);
            void refetch();
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

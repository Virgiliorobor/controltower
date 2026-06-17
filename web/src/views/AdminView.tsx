// VIEW 12 — Users & Settings (Admin only — ✱ A4). Route-guarded to admin. Two panels:
//   Users: list (email/role/active/lang), invite (POST /users), reassign role / (de)activate (PATCH /users/:id).
//   Settings: default language, freshness thresholds (stale_days / soon_days — F2), interview turn budget (F2),
//   via GET/PATCH /settings (platform-core).

import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { useUsers, useSettings, useInvalidators, errorMessage } from '../lib/hooks';
import { adminApi } from '../lib/endpoints';
import {
  EmptyState,
  ErrorStrip,
  Field,
  GhostButton,
  LoadingLine,
  Modal,
  PrimaryButton,
  Select,
  TextInput,
} from '../components/primitives';
import type { AppSettings, Locale, UserRole } from '../lib/types';

const ROLES: UserRole[] = ['editor', 'viewer', 'admin'];

function InviteModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }): JSX.Element {
  const { t } = useI18n();
  const [form, setForm] = useState({ email: '', password: '', role: 'editor' as UserRole, language_pref: 'es' as Locale });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await adminApi.createUser(form);
      onSaved();
    } catch (err) {
      setError(errorMessage(err, t('error.save')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('admin.inviteUser')} onClose={onClose}>
      <div className="space-y-4">
        <Field label={t('admin.col.email')} required>
          <TextInput type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label={t('admin.newPassword')} required hint="min 8">
          <TextInput type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('admin.col.role')}>
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('admin.col.lang')}>
            <Select value={form.language_pref} onChange={(e) => setForm({ ...form, language_pref: e.target.value as Locale })}>
              <option value="es">ES</option>
              <option value="en">EN</option>
            </Select>
          </Field>
        </div>
        {error && <div className="rounded-sm border border-status-red bg-status-red/5 px-3 py-2 text-2xs text-status-red-doc">{error}</div>}
        <div className="flex justify-end gap-2">
          <GhostButton surface="doc" onClick={onClose}>
            {t('common.cancel')}
          </GhostButton>
          <PrimaryButton onClick={save} disabled={busy}>
            {busy ? t('common.saving') : t('common.create')}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

function SettingsPanel(): JSX.Element {
  const { t } = useI18n();
  const { data, isLoading, isError, error, refetch } = useSettings(true);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  async function save(): Promise<void> {
    if (!draft) return;
    setSaveError(null);
    setSaved(false);
    setBusy(true);
    try {
      const { settings } = await adminApi.updateSettings({
        default_language: draft.default_language,
        stale_days: Number(draft.stale_days),
        soon_days: Number(draft.soon_days),
        interview_turn_budget: Number(draft.interview_turn_budget),
      });
      setDraft(settings);
      setSaved(true);
    } catch (err) {
      setSaveError(errorMessage(err, t('error.save')));
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <LoadingLine surface="board" />;
  if (isError) return <ErrorStrip message={errorMessage(error, t('error.load'))} surface="board" onRetry={() => void refetch()} />;
  if (!draft) return <EmptyState surface="board" message={t('error.load')} />;

  return (
    <div className="rounded-sm border border-doc-line bg-doc-surface p-5 text-ink">
      <h2 className="mb-4 text-base font-semibold">{t('admin.settingsTitle')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('admin.defaultLang')}>
          <Select
            value={draft.default_language}
            onChange={(e) => setDraft({ ...draft, default_language: e.target.value as Locale })}
          >
            <option value="es">ES</option>
            <option value="en">EN</option>
          </Select>
        </Field>
        <Field label={t('admin.turnBudget')}>
          <TextInput
            type="number"
            value={draft.interview_turn_budget}
            onChange={(e) => setDraft({ ...draft, interview_turn_budget: Number(e.target.value) })}
          />
        </Field>
        <Field label={t('admin.staleDays')}>
          <TextInput type="number" value={draft.stale_days} onChange={(e) => setDraft({ ...draft, stale_days: Number(e.target.value) })} />
        </Field>
        <Field label={t('admin.soonDays')}>
          <TextInput type="number" value={draft.soon_days} onChange={(e) => setDraft({ ...draft, soon_days: Number(e.target.value) })} />
        </Field>
      </div>
      {saveError && <div className="mt-3 rounded-sm border border-status-red bg-status-red/5 px-3 py-2 text-2xs text-status-red-doc">{saveError}</div>}
      {saved && <div className="mt-3 text-2xs text-status-green-doc">{t('admin.settingsSaved')}</div>}
      <div className="mt-4 flex justify-end">
        <PrimaryButton onClick={save} disabled={busy}>
          {busy ? t('common.saving') : t('admin.saveSettings')}
        </PrimaryButton>
      </div>
    </div>
  );
}

export default function AdminView(): JSX.Element {
  const { t } = useI18n();
  const { data: users, isLoading, isError, error, refetch } = useUsers(true);
  const { invalidateAll } = useInvalidators();
  const [inviting, setInviting] = useState(false);

  async function changeRole(id: string, role: UserRole): Promise<void> {
    await adminApi.updateUser(id, { role }).catch(() => undefined);
    void refetch();
  }
  async function toggleActive(id: string, is_active: boolean): Promise<void> {
    await adminApi.updateUser(id, { is_active }).catch(() => undefined);
    void refetch();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-6">
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-ink-onboard">{t('admin.usersTitle')}</h1>
          <PrimaryButton onClick={() => setInviting(true)}>{t('admin.inviteUser')}</PrimaryButton>
        </div>
        {isLoading && <LoadingLine surface="board" />}
        {isError && <ErrorStrip message={errorMessage(error, t('error.load'))} surface="board" onRetry={() => void refetch()} />}
        {users && users.length === 0 && <EmptyState surface="board" message={t('contacts.empty')} />}
        {users && users.length > 0 && (
          <table className="w-full border-collapse text-sm text-ink-onboard">
            <thead>
              <tr className="border-b border-board-line text-left text-2xs uppercase tracking-label text-ink-onboard-muted">
                <th className="py-2 pr-3 font-medium">{t('admin.col.email')}</th>
                <th className="py-2 pr-3 font-medium">{t('admin.col.role')}</th>
                <th className="py-2 pr-3 font-medium">{t('admin.col.active')}</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-board-line hover:bg-board-hover">
                  <td className="py-2 pr-3">{u.email}</td>
                  <td className="py-2 pr-3">
                    <select
                      value={u.role}
                      onChange={(e) => void changeRole(u.id, e.target.value as UserRole)}
                      className="rounded-sm border border-board-line bg-board-raised px-2 py-1 text-2xs text-ink-onboard"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {t(`role.${r}`)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-3">{u.is_active ? t('common.yes') : t('common.no')}</td>
                  <td className="py-2 text-right">
                    <GhostButton surface="board" className="py-1 text-2xs" onClick={() => void toggleActive(u.id, !u.is_active)}>
                      {u.is_active ? t('admin.deactivate') : t('admin.activate')}
                    </GhostButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <SettingsPanel />

      {inviting && (
        <InviteModal
          onClose={() => setInviting(false)}
          onSaved={() => {
            setInviting(false);
            invalidateAll();
            void refetch();
          }}
        />
      )}
    </div>
  );
}

// VIEW 7 — Create Process chooser. Editor/Admin only (route-guarded). Two paths: Formulario (→ VIEW 4) and
// Entrevista guiada IA (→ VIEW 5), each with a one-line description of when to use it. Doc surface.

import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';
import { GhostButton } from '../components/primitives';

export default function CreateChooserView(): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();

  const Card = ({ title, desc, onClick }: { title: string; desc: string; onClick: () => void }): JSX.Element => (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-2 rounded-sm border border-doc-line bg-doc-raised p-5 text-left transition-colors hover:border-accent"
    >
      <span className="text-base font-semibold text-ink">{title}</span>
      <span className="text-sm leading-wiki text-ink-muted">{desc}</span>
    </button>
  );

  return (
    <div className="min-h-[calc(100vh-48px)] bg-doc-bg">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="rounded-sm border border-doc-line bg-doc-surface p-6 text-ink">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-xl font-semibold">{t('create.title')}</h1>
            <GhostButton surface="doc" onClick={() => navigate('/')}>
              {t('common.cancel')}
            </GhostButton>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card title={t('create.form')} desc={t('create.formDesc')} onClick={() => navigate('/create/form')} />
            <Card title={t('create.interview')} desc={t('create.interviewDesc')} onClick={() => navigate('/create/interview')} />
          </div>
        </div>
      </div>
    </div>
  );
}

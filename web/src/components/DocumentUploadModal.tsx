// VIEW 9 — Document upload + attach (FLOW 4). Multipart upload to POST /api/v1/documents (file + doc_type +
// name + canonical_term_es/_en), then link to the step via POST /steps/:id/documents with a role. The AI never
// sets file_ref — only this human action does (DC-5). Validation mirrors the server: allowed formats, a file,
// at least one canonical term.

import { useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { documentApi, stepApi } from '../lib/endpoints';
import { errorMessage } from '../lib/hooks';
import { Field, GhostButton, Modal, PrimaryButton, ProgressBar, Select, TextInput } from './primitives';
import { DOC_TYPES, type DocType, type StepDocumentRole } from '../lib/types';

const ROLES: StepDocumentRole[] = ['consumes', 'produces', 'references'];

export function DocumentUploadModal({
  stepId,
  onClose,
  onAttached,
}: {
  stepId: string;
  onClose: () => void;
  onAttached: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [docType, setDocType] = useState<DocType>('Other');
  const [termEs, setTermEs] = useState('');
  const [termEn, setTermEn] = useState('');
  const [role, setRole] = useState<StepDocumentRole>('consumes');
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function submit(): Promise<void> {
    setError(null);
    if (!file) {
      setError(t('doc.needFile'));
      return;
    }
    if (!termEs.trim() && !termEn.trim()) {
      setError(t('doc.needTerm'));
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', name.trim() || file.name);
      fd.append('doc_type', docType);
      if (termEs.trim()) fd.append('canonical_term_es', termEs.trim());
      if (termEn.trim()) fd.append('canonical_term_en', termEn.trim());
      const { document } = await documentApi.upload(fd);
      await stepApi.linkDocument(stepId, document.id, role);
      onAttached();
    } catch (err) {
      setError(errorMessage(err, t('error.save')));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal title={t('doc.upload')} onClose={onClose}>
      <div className="space-y-4">
        <Field label={t('doc.file')} required hint={t('doc.allowed')}>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.xls,.xlsx,.doc,.docx,.xml,.jpg,.jpeg,.png"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !name) setName(f.name);
            }}
            className="block w-full text-sm text-ink"
          />
        </Field>
        <Field label={t('doc.name')}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('doc.type')}>
            <Select value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
              {DOC_TYPES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('doc.roleOnStep')}>
            <Select value={role} onChange={(e) => setRole(e.target.value as StepDocumentRole)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`step.docRole.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('doc.termEs')}>
            <TextInput value={termEs} onChange={(e) => setTermEs(e.target.value)} />
          </Field>
          <Field label={t('doc.termEn')}>
            <TextInput value={termEn} onChange={(e) => setTermEn(e.target.value)} />
          </Field>
        </div>

        {error && <div className="rounded-sm border border-status-red bg-status-red/5 px-3 py-2 text-2xs text-status-red-doc">{error}</div>}
        {uploading && <ProgressBar label={t('doc.uploading')} />}

        <div className="flex justify-end gap-2">
          <GhostButton surface="doc" onClick={onClose}>
            {t('common.cancel')}
          </GhostButton>
          <PrimaryButton onClick={submit} disabled={uploading}>
            {uploading ? t('doc.uploading') : t('doc.upload')}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

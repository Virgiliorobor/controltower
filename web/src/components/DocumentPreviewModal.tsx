// VIEW 8 — Document preview (Vista de documento). GET /api/v1/documents/:id returns metadata + a short-lived
// signed URL. Inline preview for PDF (iframe) and images (img); XLS/DOCX/XML show metadata + download-only (✱ A7).
// States: loading, unsupported-format (download-only note), broken/missing file (error). The signed URL is the
// live retrieval path — relative to the same origin (Rule 1).

import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { documentApi } from '../lib/endpoints';
import { errorMessage } from '../lib/hooks';
import { pickBilingual } from '../i18n/bilingual';
import { GhostButton, LoadingLine, Modal, Tag } from './primitives';
import type { DocumentRow } from '../lib/types';

export function DocumentPreviewModal({
  documentId,
  onClose,
}: {
  documentId: string;
  onClose: () => void;
}): JSX.Element {
  const { t, locale } = useI18n();
  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    documentApi
      .get(documentId)
      .then(({ document, url: signed }) => {
        if (cancelled) return;
        setDoc(document);
        setUrl(signed);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, t('doc.brokenFile')));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, t]);

  const isImage = doc ? ['.jpg', '.jpeg', '.png'].some((ext) => doc.storage_path?.toLowerCase().endsWith(ext)) || doc.format === 'other' : false;
  const isPdf = doc?.format === 'PDF';
  const canInline = (isPdf || isImage) && Boolean(url);

  return (
    <Modal title={doc?.name ?? t('common.preview')} onClose={onClose} wide>
      {loading && <LoadingLine surface="doc" />}
      {error && <div className="rounded-sm border border-status-red bg-status-red/5 px-3 py-2 text-sm text-status-red-doc">{error}</div>}

      {doc && !error && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-2xs text-ink-muted">
            <Tag surface="doc">{doc.doc_type}</Tag>
            <Tag surface="doc">{doc.format}</Tag>
            <span>
              {t('doc.term')} : {pickBilingual(locale, doc.canonical_term_es, doc.canonical_term_en)}
            </span>
            {doc.size_bytes && <span>{(Number(doc.size_bytes) / 1024).toFixed(0)} KB</span>}
          </div>

          {canInline && isPdf && url && (
            <iframe title={doc.name} src={url} className="h-[60vh] w-full rounded-sm border border-doc-line bg-white" />
          )}
          {canInline && isImage && url && (
            <img src={url} alt={doc.name} className="max-h-[60vh] w-full rounded-sm border border-doc-line object-contain" />
          )}
          {!canInline && (
            <div className="rounded-sm border border-doc-line bg-doc-raised px-4 py-6 text-center text-sm text-ink-muted">
              {t('doc.previewUnavailable')}
            </div>
          )}

          <div className="flex justify-end">
            {url ? (
              <a href={url} download={doc.name} target="_blank" rel="noreferrer">
                <GhostButton surface="doc">{t('common.download')}</GhostButton>
              </a>
            ) : (
              <span className="text-2xs text-status-red-doc">{t('doc.brokenFile')}</span>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

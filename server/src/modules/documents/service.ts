// documents service (B4) — owns the `documents` metadata table + the object-storage bytes.
// Upload flow: validate type+size → store bytes in object storage (NEVER Postgres) → write the documents row
// (metadata, content-type, size, sha256, storage_path) → emit file.uploaded. The registry consumes that event
// and an editor attaches the doc to a step (the registry owns step_documents; documents never sets a step link).
//
// The AI never sets storage_path/file_ref — only this upload path (an authenticated editor action) does (DC-5).

import { createHash, randomUUID } from 'node:crypto';
import type { DocFormat, DocType, Document } from '@prisma/client';
import type { AppContext } from '../../core/context.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { ObjectStorage } from './storage.js';

const SOURCE_NODE = 'documents';

// Allowed upload types (architecture_spec §7). MIME → DocFormat + extension allowlist.
const MIME_TO_FORMAT: Record<string, DocFormat> = {
  'application/pdf': 'PDF',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLS',
  'application/msword': 'DOCX',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/xml': 'XML',
  'text/xml': 'XML',
  'image/jpeg': 'other',
  'image/png': 'other',
};

const ALLOWED_EXTENSIONS = new Set(['pdf', 'xls', 'xlsx', 'doc', 'docx', 'xml', 'jpg', 'jpeg', 'png']);

const DOC_TYPES = new Set<DocType>([
  'PurchaseOrder', 'CommercialInvoice', 'PackingList', 'BillOfLading', 'CartaPorte', 'CertificateOfOrigin',
  'Permit_NOM', 'Pedimento', 'PaymentReceipt', 'InspectionActa', 'GoodsReceipt', 'Expediente', 'Other',
]);

export interface UploadInput {
  filename: string;
  contentType: string;
  bytes: Buffer;
  name?: string;
  doc_type: DocType;
  canonical_term_es?: string | null;
  canonical_term_en?: string | null;
  uploaded_by?: string;
}

export interface ActorMeta {
  actorId?: string;
  sessionId?: string;
}

export class DocumentsService {
  private readonly storage: ObjectStorage;

  constructor(private readonly ctx: AppContext) {
    this.storage = new ObjectStorage(ctx.config, ctx.logger);
  }

  private extensionOf(filename: string): string {
    const idx = filename.lastIndexOf('.');
    return idx >= 0 ? filename.slice(idx + 1).toLowerCase() : '';
  }

  private resolveFormat(contentType: string, ext: string): DocFormat {
    const byMime = MIME_TO_FORMAT[contentType.toLowerCase()];
    if (byMime) return byMime;
    // Fall back to extension when the client sends a generic content type.
    if (ext === 'pdf') return 'PDF';
    if (ext === 'xls' || ext === 'xlsx') return 'XLS';
    if (ext === 'doc' || ext === 'docx') return 'DOCX';
    if (ext === 'xml') return 'XML';
    if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') return 'other';
    return 'other';
  }

  async upload(input: UploadInput, meta: ActorMeta): Promise<Document> {
    const ext = this.extensionOf(input.filename);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      await this.emitAccessDenied(meta, `Unsupported file type: .${ext || '(none)'}`);
      throw new ValidationError(
        `Unsupported file type ".${ext}". Allowed: PDF, XLS(X), DOC(X), XML, JPG, PNG / Tipo de archivo no permitido.`,
      );
    }
    if (input.bytes.length === 0) {
      throw new ValidationError('Empty file / Archivo vacío');
    }
    if (input.bytes.length > this.ctx.config.DOCUMENT_MAX_BYTES) {
      await this.emitAccessDenied(meta, 'File exceeds size limit');
      throw new ValidationError(
        `File exceeds the ${this.ctx.config.DOCUMENT_MAX_BYTES} byte limit / El archivo supera el límite permitido.`,
      );
    }
    if (!DOC_TYPES.has(input.doc_type)) {
      throw new ValidationError('Invalid doc_type');
    }
    // At least one canonical term (data_model_rules) — required for bilingual term storage.
    if (!input.canonical_term_es?.trim() && !input.canonical_term_en?.trim()) {
      throw new ValidationError('At least one of canonical_term_es / canonical_term_en is required');
    }

    const format = this.resolveFormat(input.contentType, ext);
    const sha256 = createHash('sha256').update(input.bytes).digest('hex');
    // Storage key (= storage_path / file_ref). Includes the date for human-navigable buckets and a uuid so
    // re-uploads never collide. Set ONLY here (editor upload), never by the AI.
    const datePrefix = new Date().toISOString().slice(0, 10);
    const storagePath = `documents/${datePrefix}/${randomUUID()}.${ext}`;

    // 1) bytes → object storage
    await this.storage.put(storagePath, input.bytes, input.contentType);

    // 2) metadata → Postgres
    const document = await this.ctx.db.document.create({
      data: {
        name: input.name?.trim() || input.filename,
        doc_type: input.doc_type,
        format,
        canonical_term_es: input.canonical_term_es ?? null,
        canonical_term_en: input.canonical_term_en ?? null,
        storage_path: storagePath,
        content_type: input.contentType,
        size_bytes: BigInt(input.bytes.length),
        uploaded_by: meta.actorId ?? null,
      },
    });

    // 3) emit file.uploaded — the registry/audit consume it; attachment to a step stays an editor decision.
    await this.ctx.bus.emit(
      'file.uploaded',
      { id: document.id, name: document.name, doc_type: document.doc_type, format, sha256, actor_id: meta.actorId },
      { source_node: SOURCE_NODE, metadata: { session_id: meta.sessionId, triggered_by: 'file.upload_requested' } },
    );
    return document;
  }

  async getMetadataWithUrl(id: string): Promise<{ document: Document; url: string | null }> {
    const document = await this.ctx.db.document.findUnique({ where: { id } });
    if (!document || document.is_archived) throw new NotFoundError('Document not found');
    const url = document.storage_path
      ? await this.storage.signedGetUrl(document.storage_path, document.content_type ?? undefined)
      : null;
    await this.ctx.bus.emit(
      'file.retrieve_requested',
      { id: document.id },
      { source_node: SOURCE_NODE, metadata: { triggered_by: 'user.action' } },
    );
    return { document, url };
  }

  async updateMetadata(
    id: string,
    patch: { name?: string; doc_type?: DocType; canonical_term_es?: string | null; canonical_term_en?: string | null },
    meta: ActorMeta,
  ): Promise<Document> {
    const existing = await this.ctx.db.document.findUnique({ where: { id } });
    if (!existing || existing.is_archived) throw new NotFoundError('Document not found');
    if (patch.doc_type && !DOC_TYPES.has(patch.doc_type)) throw new ValidationError('Invalid doc_type');
    const nextEs = patch.canonical_term_es !== undefined ? patch.canonical_term_es : existing.canonical_term_es;
    const nextEn = patch.canonical_term_en !== undefined ? patch.canonical_term_en : existing.canonical_term_en;
    if (!nextEs?.trim() && !nextEn?.trim()) {
      throw new ValidationError('At least one of canonical_term_es / canonical_term_en is required');
    }
    const document = await this.ctx.db.document.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.doc_type !== undefined ? { doc_type: patch.doc_type } : {}),
        ...(patch.canonical_term_es !== undefined ? { canonical_term_es: patch.canonical_term_es } : {}),
        ...(patch.canonical_term_en !== undefined ? { canonical_term_en: patch.canonical_term_en } : {}),
      },
    });
    await this.ctx.bus.emit('file.updated', { id: document.id }, {
      source_node: SOURCE_NODE,
      metadata: { session_id: meta.sessionId, triggered_by: 'user.action' },
    });
    return document;
  }

  async archive(id: string, meta: ActorMeta): Promise<Document> {
    const existing = await this.ctx.db.document.findUnique({ where: { id } });
    if (!existing || existing.is_archived) throw new NotFoundError('Document not found');
    const document = await this.ctx.db.document.update({ where: { id }, data: { is_archived: true } });
    // Best-effort byte removal; the metadata row is soft-deleted (records are never hard-deleted).
    if (existing.storage_path) {
      try {
        await this.storage.delete(existing.storage_path);
      } catch (error) {
        this.ctx.logger.warn({ err: error, id }, 'object delete failed (metadata archived anyway)');
      }
    }
    await this.ctx.bus.emit('file.deleted', { id: document.id, actor_id: meta.actorId }, {
      source_node: SOURCE_NODE,
      metadata: { session_id: meta.sessionId, triggered_by: 'user.action' },
    });
    return document;
  }

  // List documents linked to a step (joins via the registry-owned step_documents — read-only here).
  async listByStep(stepId: string): Promise<unknown[]> {
    const links = await this.ctx.db.stepDocument.findMany({
      where: { step_id: stepId },
      include: { document: true },
    });
    return links.filter((l) => !l.document.is_archived).map((l) => ({ role: l.role, document: l.document }));
  }

  async ping(): Promise<boolean> {
    return this.storage.ping();
  }

  private async emitAccessDenied(meta: ActorMeta, reason: string): Promise<void> {
    await this.ctx.bus.emit('file.access_denied', { reason, actor_id: meta.actorId }, {
      source_node: SOURCE_NODE,
      metadata: { session_id: meta.sessionId, triggered_by: 'file.upload_requested' },
    });
  }
}

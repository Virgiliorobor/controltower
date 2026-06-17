// documents HTTP routes under /api/v1 (architecture_spec §4). Multipart upload (editor/admin), signed-URL
// retrieval (any authenticated role), metadata update + archive (editor/admin), list-by-step (read).
//
// @fastify/multipart is registered here (scoped to this module's needs) with the configured byte cap.

import type { FastifyInstance } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import { z } from 'zod';
import type { AppContext } from '../../core/context.js';
import { ValidationError } from '../../core/errors.js';
import type { AuthMiddleware } from '../auth-rbac/middleware.js';
import type { ActorMeta, DocumentsService } from './service.js';

const docTypeEnum = z.enum([
  'PurchaseOrder', 'CommercialInvoice', 'PackingList', 'BillOfLading', 'CartaPorte', 'CertificateOfOrigin',
  'Permit_NOM', 'Pedimento', 'PaymentReceipt', 'InspectionActa', 'GoodsReceipt', 'Expediente', 'Other',
]);
const idParam = z.object({ id: z.string().uuid() });

export async function registerDocumentsRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  deps: { auth: AuthMiddleware; service: DocumentsService },
): Promise<void> {
  const { auth, service } = deps;
  const editor = { preHandler: auth.requireRole('editor', 'admin') };
  const anyAuth = { preHandler: auth.requireAuth };

  await app.register(fastifyMultipart, {
    limits: { fileSize: ctx.config.DOCUMENT_MAX_BYTES, files: 1 },
  });

  const meta = (req: { session: { user: { id: string }; session_id: string } | null }): ActorMeta => ({
    actorId: req.session?.user.id,
    sessionId: req.session?.session_id,
  });

  // Multipart upload: one file part + text fields (doc_type, name, canonical_term_es/_en).
  app.post('/api/v1/documents', editor, async (request) => {
    const parts = request.parts();
    let fileBuffer: Buffer | null = null;
    let filename = 'upload';
    let contentType = 'application/octet-stream';
    const fields: Record<string, string> = {};

    for await (const part of parts) {
      if (part.type === 'file') {
        filename = part.filename ?? filename;
        contentType = part.mimetype ?? contentType;
        fileBuffer = await part.toBuffer();
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }

    if (!fileBuffer) throw new ValidationError('No file part provided / No se adjuntó ningún archivo');
    const docType = docTypeEnum.parse(fields.doc_type ?? 'Other');

    const document = await service.upload(
      {
        filename,
        contentType,
        bytes: fileBuffer,
        name: fields.name,
        doc_type: docType,
        canonical_term_es: fields.canonical_term_es ?? null,
        canonical_term_en: fields.canonical_term_en ?? null,
      },
      meta(request),
    );
    // BigInt is not JSON-serialisable — expose size as a string.
    return { document: { ...document, size_bytes: document.size_bytes?.toString() ?? null } };
  });

  // Metadata + a short-lived signed retrieval URL.
  app.get('/api/v1/documents/:id', anyAuth, async (request) => {
    const { id } = idParam.parse(request.params);
    const { document, url } = await service.getMetadataWithUrl(id);
    return { document: { ...document, size_bytes: document.size_bytes?.toString() ?? null }, url };
  });

  app.patch('/api/v1/documents/:id', editor, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({
      name: z.string().min(1).optional(),
      doc_type: docTypeEnum.optional(),
      canonical_term_es: z.string().nullable().optional(),
      canonical_term_en: z.string().nullable().optional(),
    }).parse(request.body);
    const document = await service.updateMetadata(id, body, meta(request));
    return { document: { ...document, size_bytes: document.size_bytes?.toString() ?? null } };
  });

  app.post('/api/v1/documents/:id/archive', editor, async (request) => {
    const { id } = idParam.parse(request.params);
    const document = await service.archive(id, meta(request));
    return { document: { ...document, size_bytes: document.size_bytes?.toString() ?? null } };
  });

  // Documents attached to a step (read; the link itself is owned by the registry).
  app.get('/api/v1/steps/:id/documents/list', anyAuth, async (request) => {
    const { id } = idParam.parse(request.params);
    return { documents: await service.listByStep(id) };
  });
}

// documents module wiring (B4). Owns the documents table + object-storage bytes. No bus subscriptions: it is
// a producer (file.uploaded/file.deleted/...) consumed by the registry and audit; it owns no inbound events.

import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../core/context.js';
import type { AuthMiddleware } from '../auth-rbac/middleware.js';
import { DocumentsService } from './service.js';
import { registerDocumentsRoutes } from './routes.js';

export { DocumentsService } from './service.js';
export { ObjectStorage } from './storage.js';

export interface DocumentsModule {
  service: DocumentsService;
}

export function buildDocumentsModule(ctx: AppContext): DocumentsModule {
  return { service: new DocumentsService(ctx) };
}

export async function registerDocumentsRoutesWithDeps(
  app: FastifyInstance,
  ctx: AppContext,
  deps: { auth: AuthMiddleware; module: DocumentsModule },
): Promise<void> {
  await registerDocumentsRoutes(app, ctx, { auth: deps.auth, service: deps.module.service });
}

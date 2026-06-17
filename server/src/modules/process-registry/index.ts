// process-registry module wiring (B3). THE single writer of the live map.
// Builds the service, registers its /api/v1 routes, and wires its bus subscriptions.

import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../core/context.js';
import type { AuthMiddleware } from '../auth-rbac/middleware.js';
import type { SettingsService } from '../platform-core/settings.js';
import { ProcessRegistryService } from './service.js';
import { registerProcessRegistryRoutes } from './routes.js';
import { registerProcessRegistrySubscriptions } from './events.js';

export { ProcessRegistryService } from './service.js';
export { computeRagStatus } from './rag.js';

export interface ProcessRegistryModule {
  service: ProcessRegistryService;
}

export function buildProcessRegistryModule(ctx: AppContext, settings: SettingsService): ProcessRegistryModule {
  const service = new ProcessRegistryService(ctx, settings);
  registerProcessRegistrySubscriptions(ctx, service);
  return { service };
}

export function registerProcessRegistryRoutesWithDeps(
  app: FastifyInstance,
  ctx: AppContext,
  deps: { auth: AuthMiddleware; module: ProcessRegistryModule },
): void {
  registerProcessRegistryRoutes(app, ctx, { auth: deps.auth, service: deps.module.service });
}

// ai-gateway module wiring (B8/B9). Hosts the ICM AI layer; owns process_drafts/freshness_reports/ai_runs.
// Built with a READ-ONLY snapshot provider from the registry (not the registry service itself) so this module
// can never write the registry — the write-path boundary is enforced in the wiring, not just by convention.

import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../core/context.js';
import type { AuthMiddleware } from '../auth-rbac/middleware.js';
import type { SettingsService } from '../platform-core/settings.js';
import { AiGatewayService } from './service.js';
import { registerAiGatewayRoutes } from './routes.js';
import { registerAiGatewaySubscriptions } from './events.js';

export { AiGatewayService } from './service.js';

export interface AiGatewayModule {
  service: AiGatewayService;
}

export function buildAiGatewayModule(
  ctx: AppContext,
  settings: SettingsService,
  // A read-only snapshot compiler from the registry. The gateway receives ONLY this read function — never the
  // registry's write surface. This is the code-level guarantee that the AI layer is not in a write path.
  snapshotProvider: (processId: string) => Promise<unknown>,
): AiGatewayModule {
  const service = new AiGatewayService(ctx, settings, snapshotProvider);
  registerAiGatewaySubscriptions(ctx, service);
  return { service };
}

export function registerAiGatewayRoutesWithDeps(
  app: FastifyInstance,
  ctx: AppContext,
  deps: { auth: AuthMiddleware; module: AiGatewayModule },
): void {
  registerAiGatewayRoutes(app, ctx, { auth: deps.auth, service: deps.module.service });
}

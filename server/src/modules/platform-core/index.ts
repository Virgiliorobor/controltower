// platform-core module wiring. Layer 0 — always on. Wires the audit writer (subscribes to all bus events),
// the settings service, and the freshness scheduler. Exposes the SettingsService so other modules read settings
// through it (never reading app_settings directly).

import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../core/context.js';
import type { AuthMiddleware } from '../auth-rbac/middleware.js';
import { registerAuditWriter } from './audit.js';
import { SettingsService } from './settings.js';
import { FreshnessScheduler } from './scheduler.js';
import { registerPlatformRoutes } from './routes.js';

export { SettingsService } from './settings.js';
export { FreshnessScheduler } from './scheduler.js';

export interface PlatformCore {
  settings: SettingsService;
  scheduler: FreshnessScheduler;
}

export async function initPlatformCore(ctx: AppContext): Promise<PlatformCore> {
  registerAuditWriter(ctx);
  const settings = new SettingsService(ctx);
  await settings.ensureDefaults();
  const scheduler = new FreshnessScheduler(ctx);
  return { settings, scheduler };
}

export function registerPlatformCoreRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  deps: { auth: AuthMiddleware; platform: PlatformCore },
): void {
  registerPlatformRoutes(app, ctx, { auth: deps.auth, settings: deps.platform.settings });
}

// platform-core HTTP routes — admin-only system settings + read-only audit log view.
// Settings drive freshness thresholds + interview turn budget; the registry and ai-gateway read them via
// SettingsService. The audit view is read-only (audit_events is append-only).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../core/context.js';
import type { AuthMiddleware } from '../auth-rbac/middleware.js';
import { SettingsService, settingsSchema } from './settings.js';

const updateSettingsSchema = settingsSchema.partial();

const auditQuerySchema = z.object({
  entity_type: z.string().optional(),
  entity_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function registerPlatformRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  deps: { auth: AuthMiddleware; settings: SettingsService },
): void {
  const { auth, settings } = deps;

  app.get('/api/v1/settings', { preHandler: auth.requireRole('admin') }, async () => {
    return { settings: await settings.get() };
  });

  app.patch('/api/v1/settings', { preHandler: auth.requireRole('admin') }, async (request) => {
    const body = updateSettingsSchema.parse(request.body);
    const updated = await settings.update(body, request.session?.user.id);
    return { settings: updated };
  });

  app.get('/api/v1/audit', { preHandler: auth.requireRole('admin') }, async (request) => {
    const query = auditQuerySchema.parse(request.query);
    const events = await ctx.db.auditEvent.findMany({
      where: {
        ...(query.entity_type ? { entity_type: query.entity_type } : {}),
        ...(query.entity_id ? { entity_id: query.entity_id } : {}),
      },
      orderBy: { timestamp: 'desc' },
      take: query.limit,
    });
    return { events };
  });
}

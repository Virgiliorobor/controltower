// Server entry point. Composition root: builds the AppContext, wires Builder A's modules (platform-core,
// auth-rbac), registers their /api routes, mounts the built SPA as static with a non-/api SPA fallback,
// recovers any pending outbox events, starts the freshness scheduler, and listens on $PORT.
//
// Builders B and C extend this file's MODULE WIRING and ROUTES blocks (clearly marked) to plug their modules
// in — registering routes under /api/v1 and subscribing to bus events. They add nothing outside those blocks.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './core/config.js';
import { getDb, disconnectDb } from './core/db.js';
import { logger } from './core/logger.js';
import { EventBus } from './core/event-bus.js';
import { buildApp } from './core/app.js';
import type { AppContext } from './core/context.js';
import { initPlatformCore, registerPlatformCoreRoutes } from './modules/platform-core/index.js';
import { buildAuthModule, registerAuthRoutes } from './modules/auth-rbac/index.js';
import { buildProcessRegistryModule, registerProcessRegistryRoutesWithDeps } from './modules/process-registry/index.js';
import { buildDocumentsModule, registerDocumentsRoutesWithDeps } from './modules/documents/index.js';
import { buildAiGatewayModule, registerAiGatewayRoutesWithDeps } from './modules/ai-gateway/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveWebDir(config: ReturnType<typeof loadConfig>): string | null {
  const candidates = [
    config.WEB_DIST_DIR,
    join(__dirname, '..', 'web'), // runtime layout: dist/ next to web/
    join(__dirname, '..', '..', 'web', 'dist'), // monorepo layout
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
  return candidates.find((candidate) => existsSync(join(candidate, 'index.html'))) ?? null;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = getDb();
  const bus = new EventBus(db, logger);
  const ctx: AppContext = { config, db, bus, logger };

  const app = await buildApp(ctx);

  // ---------------------------------------------------------------------------
  // MODULE WIRING (Builder A: platform-core, auth-rbac).
  // Builders B and C: init your module here and register its bus subscriptions.
  // ---------------------------------------------------------------------------
  const platform = await initPlatformCore(ctx);
  const auth = buildAuthModule(ctx);

  // Builder B modules (process-registry, documents, ai-gateway).
  // process-registry = THE single writer of the live map (owns the step↔document link).
  const registry = buildProcessRegistryModule(ctx, platform.settings);
  // documents = S3-compatible storage + metadata; emits file.uploaded (registry links on the editor action).
  const documents = buildDocumentsModule(ctx);
  // ai-gateway = bus↔ICM adapter. Receives ONLY a READ-only snapshot provider from the registry — never the
  // registry's write surface — so the AI layer is provably not in a write path (architecture_spec §2/§8).
  const aiGateway = buildAiGatewayModule(ctx, platform.settings, (processId) =>
    registry.service.compileSnapshot(processId),
  );

  // ---------------------------------------------------------------------------
  // ROUTES (all under /api/v1). Builders B and C: register your module's routes here.
  // ---------------------------------------------------------------------------
  registerAuthRoutes(app, ctx, auth);
  registerPlatformCoreRoutes(app, ctx, { auth: auth.middleware, platform });
  registerProcessRegistryRoutesWithDeps(app, ctx, { auth: auth.middleware, module: registry });
  await registerDocumentsRoutesWithDeps(app, ctx, { auth: auth.middleware, module: documents });
  registerAiGatewayRoutesWithDeps(app, ctx, { auth: auth.middleware, module: aiGateway });

  // ---------------------------------------------------------------------------
  // SPA static hosting + fallback. /api is owned by routes above; everything else
  // serves the built React bundle (index.html) so client-side routes resolve.
  // ---------------------------------------------------------------------------
  const webDir = resolveWebDir(config);
  if (webDir) {
    await app.register(fastifyStatic, { root: webDir, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url && request.raw.url.startsWith('/api')) {
        void reply.status(404).send({ error: 'not_found', message: 'Unknown API route' });
        return;
      }
      void reply.sendFile('index.html');
    });
    logger.info({ webDir }, 'serving SPA static bundle');
  } else {
    logger.warn('no web build found — API-only mode (run `npm run build` in web/ to produce the SPA bundle)');
  }

  // Restart recovery: redeliver any outbox events not delivered before the last shutdown.
  const recovered = await bus.recoverPending();
  if (recovered > 0) {
    logger.info({ recovered }, 'recovered pending outbox events');
  }

  platform.scheduler.start();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    platform.scheduler.stop();
    await app.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  logger.info({ port: config.PORT }, 'customs-control-tower listening');
}

main().catch((error) => {
  logger.error({ err: error }, 'fatal startup error');
  process.exit(1);
});

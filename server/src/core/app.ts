// Fastify app factory. Same-origin by default (CORS off unless explicit origins are configured), helmet,
// signed cookies, rate-limit, a global typed error handler, and /healthz. The SPA static + /api split and the
// SPA fallback are wired in index.ts after modules register their /api routes.

import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { AppContext } from './context.js';
import { AppError, isAppError } from './errors.js';

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app: FastifyInstance = Fastify({
    // pino instance satisfies Fastify's logger contract at runtime; the cast bridges the nominal type gap.
    loggerInstance: ctx.logger as unknown as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: ctx.config.DOCUMENT_MAX_BYTES,
    disableRequestLogging: false,
  });

  await app.register(helmet, {
    // The SPA is served from the same origin; CSP defaults are safe. contentSecurityPolicy can be tightened
    // by Builder C once the web asset hosts are known (fonts, etc.). Off here to avoid blocking the bundle.
    contentSecurityPolicy: false,
  });

  // CORS OFF by default — same-origin only. Enabled only if explicit origins are configured (never '*').
  if (ctx.config.CORS_ORIGINS.length > 0) {
    await app.register(cors, {
      origin: ctx.config.CORS_ORIGINS,
      credentials: true,
    });
  }

  await app.register(cookie, {
    secret: ctx.config.SESSION_SECRET,
    hook: 'onRequest',
  });

  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      void reply.status(400).send({
        error: 'validation_error',
        message: 'Invalid input',
        details: error.issues,
      });
      return;
    }
    if (isAppError(error)) {
      void reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
      return;
    }
    // Fastify's own rate-limit / validation errors carry a statusCode.
    const err = error as { statusCode?: number; message?: string };
    const statusCode = err.statusCode ?? 500;
    if (statusCode >= 500) {
      ctx.logger.error({ err: error }, 'unhandled error');
    }
    void reply.status(statusCode).send({
      error: statusCode >= 500 ? 'internal_error' : 'request_error',
      message: statusCode >= 500 ? 'Internal server error' : (err.message ?? 'Request error'),
    });
  });

  app.get('/healthz', async () => {
    return { status: 'ok', service: 'customs-control-tower', timestamp: new Date().toISOString() };
  });

  // Readiness: confirms the DB is reachable. Used by Coolify/health checks.
  app.get('/readyz', async (_request, reply) => {
    try {
      await ctx.db.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch (error) {
      ctx.logger.error({ err: error }, 'readiness check failed');
      throw new AppError(503, 'not_ready', 'Database not reachable');
    }
  });

  return app;
}

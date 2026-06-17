// auth-rbac HTTP routes under /api/v1. Login/logout/me + admin user management.
// Input validated at the boundary (zod). The session id rides in an httpOnly, signed, SameSite=Strict cookie —
// never localStorage (security baseline). Secure flag is on in production.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../core/context.js';
import { ValidationError } from '../../core/errors.js';
import { AuthService } from './service.js';
import { AuthMiddleware, SESSION_COOKIE } from './middleware.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['editor', 'viewer', 'admin']).optional(),
  language_pref: z.enum(['es', 'en']).optional(),
});

const updateUserSchema = z.object({
  role: z.enum(['editor', 'viewer', 'admin']).optional(),
  is_active: z.boolean().optional(),
  language_pref: z.enum(['es', 'en']).optional(),
});

export interface AuthModule {
  service: AuthService;
  middleware: AuthMiddleware;
}

export function buildAuthModule(ctx: AppContext): AuthModule {
  const service = new AuthService(ctx);
  const middleware = new AuthMiddleware(service);
  return { service, middleware };
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext, mod: AuthModule): void {
  const { service, middleware } = mod;
  const secure = ctx.config.NODE_ENV === 'production';
  const maxAge = ctx.config.SESSION_TTL_HOURS * 60 * 60;

  // Resolve the session for every request (sets request.session, possibly null).
  app.addHook('preHandler', middleware.attachSession);

  app.post('/api/v1/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const result = await service.login(body.email, body.password, {
      session_id: request.session?.session_id,
    });
    void reply.setCookie(SESSION_COOKIE, result.session_id, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      signed: true,
      path: '/',
      maxAge,
    });
    return { user: result.user, expires_at: result.expires_at.toISOString() };
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    await service.logout(request.session?.session_id);
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/v1/me', { preHandler: middleware.requireAuth }, async (request) => {
    return { user: request.session?.user ?? null };
  });

  // Password reset is admin-driven for this internal tool (no public self-service signup).
  app.post(
    '/api/v1/auth/password-reset',
    { preHandler: middleware.requireRole('admin') },
    async (request) => {
      const body = z.object({ user_id: z.string().uuid(), new_password: z.string().min(8) }).parse(request.body);
      await service.setPassword(body.user_id, body.new_password);
      return { ok: true };
    },
  );

  // --- Admin: users ---
  app.get('/api/v1/users', { preHandler: middleware.requireRole('admin') }, async () => {
    return { users: await service.listUsers() };
  });

  app.post('/api/v1/users', { preHandler: middleware.requireRole('admin') }, async (request) => {
    const body = createUserSchema.parse(request.body);
    const user = await service.createUser(body, request.session?.user.id);
    return { user };
  });

  app.patch('/api/v1/users/:id', { preHandler: middleware.requireRole('admin') }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateUserSchema.parse(request.body);
    if (Object.keys(body).length === 0) {
      throw new ValidationError('No fields to update');
    }
    const user = await service.updateUser(id, body, request.session?.user.id);
    return { user };
  });
}

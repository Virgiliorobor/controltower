// RBAC middleware — usable by EVERY module (Builders B and C call requireRole on their protected routes).
// Defense-in-depth layer 1: the auth middleware checks the session cookie + role before any module runs.
// (Layer 2 is Postgres RLS; layer 3 is cosmetic role chrome in the SPA.) Auth is checked before any data access.
//
// Usage in a module's routes (B/C):
//   app.get('/api/v1/processes', { preHandler: ctx.auth.requireRole('viewer','editor','admin') }, handler)
// and read the user from `request.session` (typed below).

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { UserRole } from '@prisma/client';
import { AuthError, ForbiddenError } from '../../core/errors.js';
import type { AuthenticatedSession, AuthService } from './service.js';

export const SESSION_COOKIE = 'cct_session';

declare module 'fastify' {
  interface FastifyRequest {
    session: AuthenticatedSession | null;
  }
}

export class AuthMiddleware {
  constructor(private readonly service: AuthService) {}

  // Resolves the session from the signed cookie and attaches it to the request. Never rejects — that is
  // requireRole's job — so public routes (login) can still see request.session === null.
  attachSession: preHandlerHookHandler = async (request: FastifyRequest) => {
    const raw = request.cookies[SESSION_COOKIE];
    const unsigned = raw ? request.unsignCookie(raw) : { valid: false, value: null };
    const sessionId = unsigned.valid && unsigned.value ? unsigned.value : undefined;
    request.session = await this.service.resolveSession(sessionId);
  };

  // Route guard factory. Throws AuthError (401) if unauthenticated, ForbiddenError (403) if role not allowed.
  requireRole(...allowed: UserRole[]): preHandlerHookHandler {
    return async (request: FastifyRequest, _reply: FastifyReply) => {
      if (!request.session) {
        throw new AuthError();
      }
      if (allowed.length > 0 && !allowed.includes(request.session.user.role)) {
        throw new ForbiddenError(`Requires role: ${allowed.join(' | ')}`);
      }
    };
  }

  // Any authenticated user, any role.
  get requireAuth(): preHandlerHookHandler {
    return this.requireRole('editor', 'viewer', 'admin');
  }
}

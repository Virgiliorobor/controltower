// auth-rbac service — email+password (bcrypt), httpOnly signed-cookie sessions, role assignment, account lock.
// Owns: users, user_sessions. The ONLY writer of those tables. Emits user.* events to the bus.
// Sessions live in user_sessions; the cookie carries only the opaque session id (signed by Fastify cookie).
// Passwords are bcrypt-hashed; password_hash is never logged or returned.

import bcrypt from 'bcryptjs';
import type { Prisma, User, UserRole, LanguageCode } from '@prisma/client';
import type { AppContext } from '../../core/context.js';
import { AuthError, ConflictError, ForbiddenError, NotFoundError } from '../../core/errors.js';

const SOURCE_NODE = 'auth-rbac';
const BCRYPT_ROUNDS = 12;

export interface PublicUser {
  id: string;
  email: string;
  role: UserRole;
  language_pref: LanguageCode;
  is_active: boolean;
}

export interface AuthenticatedSession {
  session_id: string;
  user: PublicUser;
  expires_at: Date;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    language_pref: user.language_pref,
    is_active: user.is_active,
  };
}

export class AuthService {
  constructor(private readonly ctx: AppContext) {}

  private sessionTtlMs(): number {
    return this.ctx.config.SESSION_TTL_HOURS * 60 * 60 * 1000;
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  async login(
    email: string,
    password: string,
    metadata: { session_id?: string } = {},
  ): Promise<AuthenticatedSession> {
    const user = await this.ctx.db.user.findUnique({ where: { email: email.toLowerCase() } });

    const failAndThrow = async (reason: string): Promise<never> => {
      await this.ctx.bus.emit(
        'user.auth_failed',
        { email: email.toLowerCase(), reason },
        { source_node: SOURCE_NODE, metadata: { triggered_by: 'user.login_requested' } },
      );
      throw new AuthError('Invalid credentials');
    };

    if (!user || !user.is_active || user.is_archived) {
      return failAndThrow('unknown_or_inactive');
    }
    if (user.locked_until && user.locked_until > new Date()) {
      return failAndThrow('locked');
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      const attempts = user.failed_attempts + 1;
      const locked = attempts >= this.ctx.config.LOGIN_MAX_ATTEMPTS;
      await this.ctx.db.user.update({
        where: { id: user.id },
        data: {
          failed_attempts: attempts,
          locked_until: locked ? new Date(Date.now() + 15 * 60 * 1000) : null,
        },
      });
      return failAndThrow('bad_password');
    }

    await this.ctx.db.user.update({
      where: { id: user.id },
      data: { failed_attempts: 0, locked_until: null },
    });

    const expiresAt = new Date(Date.now() + this.sessionTtlMs());
    const session = await this.ctx.db.userSession.create({
      data: { user_id: user.id, expires_at: expiresAt },
    });

    await this.ctx.bus.emit(
      'user.authenticated',
      { actor_id: user.id, id: user.id, role: user.role },
      { source_node: SOURCE_NODE, metadata: { session_id: metadata.session_id, triggered_by: 'user.login_requested' } },
    );

    return { session_id: session.id, user: toPublicUser(user), expires_at: expiresAt };
  }

  async resolveSession(sessionId: string | undefined): Promise<AuthenticatedSession | null> {
    if (!sessionId) return null;
    const session = await this.ctx.db.userSession.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });
    if (!session || session.revoked_at || session.expires_at < new Date()) {
      return null;
    }
    if (!session.user.is_active || session.user.is_archived) {
      return null;
    }
    return {
      session_id: session.id,
      user: toPublicUser(session.user),
      expires_at: session.expires_at,
    };
  }

  async logout(sessionId: string | undefined): Promise<void> {
    if (!sessionId) return;
    const session = await this.ctx.db.userSession.findUnique({ where: { id: sessionId } });
    if (!session || session.revoked_at) return;
    await this.ctx.db.userSession.update({
      where: { id: sessionId },
      data: { revoked_at: new Date() },
    });
    await this.ctx.bus.emit(
      'user.logged_out',
      { actor_id: session.user_id, id: session.user_id },
      { source_node: SOURCE_NODE, metadata: { triggered_by: 'user.logout_requested' } },
    );
  }

  async createUser(
    input: { email: string; password: string; role?: UserRole; language_pref?: LanguageCode },
    actorId?: string,
  ): Promise<PublicUser> {
    const email = input.email.toLowerCase();
    const existing = await this.ctx.db.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictError('A user with that email already exists');
    }
    const password_hash = await this.hashPassword(input.password);
    const user = await this.ctx.db.user.create({
      data: {
        email,
        password_hash,
        role: input.role ?? 'editor',
        language_pref: input.language_pref ?? this.ctx.config.DEFAULT_LOCALE,
      },
    });
    await this.ctx.bus.emit(
      'user.created',
      { actor_id: actorId, id: user.id, email: user.email, role: user.role },
      { source_node: SOURCE_NODE, metadata: { triggered_by: 'user.action' } },
    );
    return toPublicUser(user);
  }

  async updateUser(
    id: string,
    patch: { role?: UserRole; is_active?: boolean; language_pref?: LanguageCode },
    actorId?: string,
  ): Promise<PublicUser> {
    const existing = await this.ctx.db.user.findUnique({ where: { id } });
    if (!existing || existing.is_archived) {
      throw new NotFoundError('User not found');
    }
    const data: Prisma.UserUpdateInput = {};
    if (patch.role !== undefined) data.role = patch.role;
    if (patch.is_active !== undefined) data.is_active = patch.is_active;
    if (patch.language_pref !== undefined) data.language_pref = patch.language_pref;

    const user = await this.ctx.db.user.update({ where: { id }, data });
    await this.ctx.bus.emit(
      'user.updated',
      { actor_id: actorId, id: user.id, role: user.role, is_active: user.is_active },
      { source_node: SOURCE_NODE, metadata: { triggered_by: 'user.action' } },
    );
    return toPublicUser(user);
  }

  async listUsers(): Promise<PublicUser[]> {
    const users = await this.ctx.db.user.findMany({
      where: { is_archived: false },
      orderBy: { created_at: 'asc' },
    });
    return users.map(toPublicUser);
  }

  async setPassword(id: string, newPassword: string): Promise<void> {
    const user = await this.ctx.db.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundError('User not found');
    await this.ctx.db.user.update({
      where: { id },
      data: { password_hash: await this.hashPassword(newPassword), failed_attempts: 0, locked_until: null },
    });
  }

  assertRole(session: AuthenticatedSession | null, ...allowed: UserRole[]): AuthenticatedSession {
    if (!session) throw new AuthError();
    if (!allowed.includes(session.user.role)) {
      throw new ForbiddenError(`Requires role: ${allowed.join(' | ')}`);
    }
    return session;
  }
}

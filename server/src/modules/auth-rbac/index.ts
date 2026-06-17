// auth-rbac module wiring. Exposes the AuthService (createUser admin path, used by the seed) and the
// AuthMiddleware (requireRole) that EVERY other module imports to guard its routes.

export { AuthService, toPublicUser } from './service.js';
export type { PublicUser, AuthenticatedSession } from './service.js';
export { AuthMiddleware, SESSION_COOKIE } from './middleware.js';
export { buildAuthModule, registerAuthRoutes } from './routes.js';
export type { AuthModule } from './routes.js';

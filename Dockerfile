# Customs Control Tower — multi-stage build (npm workspaces).
# The repo is an npm workspace: one package-lock.json at the root, with server/ and web/ as members.
# All npm ci calls use the workspace root to keep the lockfile authoritative.
# Stage 1: build the React (Vite) web bundle.
# Stage 2: build the Fastify + TypeScript server and generate the Prisma client.
# Stage 3: slim runtime — serves the web build as static + SPA fallback, exposes /api on $PORT.
# No localhost anywhere — the container reads every endpoint from environment at runtime.

# ---------- Stage 1: web build ----------
FROM node:20-alpine AS web-build
WORKDIR /app
# Override any injected NODE_ENV=production (Coolify passes it as a build arg by default).
# npm ci respects NODE_ENV and skips devDependencies when NODE_ENV=production, which would
# omit TypeScript and Vite — breaking the build. Build stages need devDependencies.
ENV NODE_ENV=development
# Workspace root manifests (the single lockfile lives at the root).
COPY package.json package-lock.json ./
# Both workspace package.json files are required for npm ci to resolve workspace members.
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm ci
COPY web/ ./web/
RUN npm run build:web

# ---------- Stage 2: server build ----------
FROM node:20-alpine AS server-build
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm ci
# Server source (includes prisma/ schema directory).
COPY server/ ./server/
# npm run build:server delegates to "prisma generate && tsc" inside the server/ workspace cwd.
RUN npm run build:server

# ---------- Stage 3: runtime ----------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# OpenSSL is required at runtime for two reasons:
# 1. Prisma's engine-selection logic probes the system OpenSSL version. Without it, Prisma
#    defaults to "openssl-1.1.x" and tries to load libquery_engine-linux-musl.so.node, which
#    requires libssl.so.1.1 — not present on Alpine 3.20+.
# 2. The linux-musl-openssl-3.0.x engine (declared in schema.prisma binaryTargets) links
#    against libssl.so.3, provided by the openssl package.
RUN apk add --no-cache openssl

# Install production dependencies from the workspace root (reproducible from the lockfile).
# Web prod deps (React etc.) are already bundled in the Vite output; they add ~20 MB here
# but are harmless and keep the single-lockfile approach consistent.
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm ci --omit=dev

# Prisma: @prisma/client is installed above; overlay the generated .prisma/ client from server-build.
COPY --from=server-build /app/node_modules/.prisma ./node_modules/.prisma

# Keep server artifacts under server/ so npm workspace scripts run from /app/server/ find them.
# This means `npm run seed` and `npm run migrate` work correctly from the container terminal.
COPY --from=server-build /app/server/prisma ./server/prisma
COPY --from=server-build /app/server/dist ./server/dist

# The built SPA, served as static + SPA fallback by the Fastify app.
COPY --from=web-build /app/web/dist ./web

# The server reads WEB_DIST_DIR to locate the static bundle.
ENV WEB_DIST_DIR=/app/web
ENV PORT=8080
EXPOSE 8080

# Liveness/readiness probe. /readyz also confirms the DB is reachable.
# In-container loopback (127.0.0.1) is the Docker health convention — not an app config endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/readyz || exit 1

# Run migrations then start the server.
# --schema path is relative to WORKDIR /app (schema now lives at server/prisma/).
# `prisma migrate deploy` is idempotent — safe on every restart.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy --schema=server/prisma/schema.prisma && node server/dist/index.js"]

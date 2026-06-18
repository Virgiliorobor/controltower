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

# Install production dependencies from the workspace root (reproducible from the lockfile).
# Web prod deps (React etc.) are already bundled in the Vite output; they add ~20 MB here
# but are harmless and keep the single-lockfile approach consistent.
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm ci --omit=dev

# Prisma: @prisma/client is installed above; overlay the generated .prisma/ client from server-build.
COPY --from=server-build /app/node_modules/.prisma ./node_modules/.prisma
# Schema needed by `prisma migrate deploy` (the Coolify release step).
COPY --from=server-build /app/server/prisma ./prisma

# Compiled server. tsconfig.json has outDir=dist relative to server/, so output is at server/dist/.
# Flatten to /app/dist so CMD stays: node dist/index.js from WORKDIR /app.
COPY --from=server-build /app/server/dist ./dist

# The built SPA, served as static + SPA fallback by the Fastify app.
COPY --from=web-build /app/web/dist ./web

# The server reads WEB_DIST_DIR to locate the static bundle (defaults to ./web beside dist/).
ENV WEB_DIST_DIR=/app/web
ENV PORT=8080
EXPOSE 8080

# Liveness/readiness probe. /readyz also confirms the DB is reachable.
# In-container loopback (127.0.0.1) is the Docker health convention — not an app config endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/readyz || exit 1

# Start the server. Migrations are a SEPARATE Coolify release step (`npm run migrate`).
CMD ["node", "dist/index.js"]

# Customs Control Tower — multi-stage build.
# Stage 1: build the React (Vite) web bundle.
# Stage 2: build the Fastify + TypeScript server and generate the Prisma client.
# Stage 3: slim runtime that serves the web build as static + SPA fallback and exposes /api on $PORT.
# No localhost anywhere — the container reads every endpoint from environment at runtime.

# ---------- Stage 1: web build ----------
FROM node:20-alpine AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---------- Stage 2: server build ----------
FROM node:20-alpine AS server-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm ci
COPY server/ ./
RUN npx prisma generate
RUN npm run build

# ---------- Stage 3: runtime ----------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Install only production dependencies for the server (reproducible from the lockfile).
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev

# Prisma client (generated) + compiled server.
COPY --from=server-build /app/server/node_modules/.prisma ./node_modules/.prisma
COPY --from=server-build /app/server/node_modules/@prisma ./node_modules/@prisma
COPY --from=server-build /app/server/prisma ./prisma
COPY --from=server-build /app/server/dist ./dist

# The built SPA, served as static + SPA fallback by the Fastify app.
COPY --from=web-build /app/web/dist ./web

# The server reads WEB_DIST_DIR to locate the static bundle (defaults to ./web next to dist).
ENV WEB_DIST_DIR=/app/web
ENV PORT=8080
EXPOSE 8080

# Liveness/readiness for the orchestrator. /readyz also confirms the DB is reachable (see core readiness probe).
# In-container loopback (127.0.0.1) is the container talking to itself — NOT a configured app endpoint (Rule 1
# is about app config/hosts, which remain env-driven; this is the standard Docker health convention).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/readyz || exit 1

# Start the server only. Migrations are a SEPARATE Coolify release step (`npm run migrate` = prisma migrate
# deploy) per DEPLOY_RUNBOOK §4 — kept out of CMD so app restarts never run migrations implicitly.
CMD ["node", "dist/index.js"]

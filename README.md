# Customs Control Tower — Module 1 (Process)

A modular monolith that turns a cross-border IMMEX trade operation's scattered knowledge into living SOPs:
a navigable left-to-right process **map** (nodes = steps, edges = handoffs) with click-through **wiki** detail,
created via form or a Claude-backed guided **interview** — built first for IMMEX manufacturers in Mexico and
their corporate/HQ. One Fastify+React container, Postgres, and S3-compatible object storage, deployed on the
owner's VPS via Coolify. **No localhost** anywhere (Rule 1): config is env-driven, the SPA uses relative `/api`
paths, and only production build artifacts ship.

> This repo maps directly to `_projects/customs-control-tower/architecture_spec.md`. That spec is authoritative.

---

## Architecture at a glance

A single deployable app with internal **bounded contexts** ("modules") that communicate **only over the
in-process event bus** (Rule 4) and own their tables exclusively (Single Writer Rule). The AI layer is hosted
inside `ai-gateway` and is **never in a write path** — its outputs terminate at a human Save/decision.

| # | Module | Owns (tables) | Status |
|---|---|---|---|
| M0 | `platform-core` | `event_outbox`, `audit_events`, `app_settings` | **built (Builder A)** |
| M1 | `auth-rbac` | `users`, `user_sessions` | **built (Builder A)** |
| M2 | `process-registry` | `processes`, `steps`, `handoffs`, `responsible_parties`, `io_items`, `step_io`, `step_documents` | schema built; module = Builder B/C |
| M3 | `documents` | `documents` (+ object storage) | schema built; module = Builder B/C |
| M4 | `ai-gateway` | `process_drafts`, `freshness_reports`, `ai_runs` | schema built; module = Builder B/C |
| M5 | `web-app` | — (calls the API) | skeleton built (Builder A); views = Builder C |

Builder A (this foundation) delivered: the repo skeleton, the **complete Prisma schema for every module**
(the single source of truth), `platform-core`, `auth-rbac`, the seed, and the build/deploy toolchain.

### Stack
- **Backend:** Node.js + TypeScript (strict, ESM), Fastify 5.
- **ORM/migrations:** Prisma (the only sanctioned schema-change path).
- **Database:** PostgreSQL 16 (Coolify service).
- **Event bus:** in-process typed `EventBus` + a Postgres `event_outbox` (durable, restart-recoverable, feeds the
  append-only `audit_events`). No Redis at this scale.
- **Frontend:** React 18 + Vite (build tool) + TypeScript + TailwindCSS; React Flow (Builder C) for the map.
- **AI:** `@anthropic-ai/sdk`, server-side only (keys in env, never in the SPA).
- **Auth:** email+password (bcrypt), httpOnly signed-cookie sessions, RBAC (editor/viewer/admin) enforced by
  app-layer middleware on every route. Postgres RLS is authored but post-launch (see the auth convention below).
- **Storage:** S3-compatible (MinIO container + persistent volume on the VPS, or external S3 by config).
- **Container:** multi-stage Docker; deployed by Coolify.

---

## Layout

```
src/
  package.json            # workspace root; orchestrates web + server builds
  Dockerfile              # multi-stage: web build -> server build -> slim runtime (serves SPA + /api)
  docker-compose.yml      # Coolify/VPS descriptor: cct-app, cct-postgres:16, cct-minio + 2 named volumes
  .env.example            # every env var NAME (safe placeholders) — see deployment_config.md
  server/
    prisma/
      schema.prisma       # THE schema for ALL modules — single source of truth (do not edit in B/C)
      migrations/         # 0001_init (tables) + 0002_constraints_rls (CHECKs, partial unique, RLS)
    src/
      index.ts            # composition root: wires modules, routes, SPA static + fallback, scheduler
      core/               # config (zod env), db (Prisma singleton), event-bus, events, logger, errors, app, context
      modules/
        platform-core/    # audit writer (subscribes '*'), settings service, freshness scheduler (cron hook), routes
        auth-rbac/         # bcrypt service, session middleware (requireRole), login/logout/me + admin user routes
      seed/               # seed.ts + seed-data.ts (the 12-step INFERRED IMMEX process)
  web/
    src/
      main.tsx, App.tsx   # minimal shell (brand tick + ES|EN toggle + /healthz probe) — Builder C builds views
      lib/api.ts          # API client — RELATIVE /api paths, credentials:'include', no host hardcoded
      i18n/               # ES/EN catalog (Spanish default) + I18nProvider/useI18n
      index.css           # Control Room Slate tokens as CSS variables
    tailwind.config.ts    # Control Room Slate tokens as the Tailwind theme (board-* / doc-* / accent / status)
```

---

## Conventions Builders B and C MUST follow

1. **One Prisma schema.** `server/prisma/schema.prisma` (Builder A) is the single source of truth. Import the
   generated client via `getDb()` from `core/db.ts`. **Never edit `schema.prisma`** — if it must change, raise a
   `[DEVIATION]` in `dev_record.md` for Builder A.
2. **Event-bus-only between modules (Rule 4).** No module imports another module's service to call it directly.
   Cross-module communication is `ctx.bus.emit(...)` / `ctx.bus.subscribe(...)`. Add new event names to the
   `EventType` union in `core/events.ts` (typed; a typo is a compile error).
3. **Exclusive table ownership (single-writer).** Only the owning module writes its tables (see the table above).
   `process-registry` owns the step↔document link; `documents` owns the bytes/metadata.
4. **All HTTP under `/api/v1`, same-origin.** Register routes in the ROUTES block of `index.ts`. The SPA falls
   back to `index.html` for any non-`/api` route. The SPA uses relative paths only (`lib/api.ts`).
5. **Auth at the boundary.** Guard every protected route with `auth.middleware.requireRole('editor', ...)`.
   `request.session` carries the authenticated user (or null). This middleware is the ENFORCED authorization
   control today. RLS is the intended second layer but is **authored-and-inert in the shipped default** (the app
   connects as the table owner, which bypasses RLS); see `DEPLOY_RUNBOOK.md` "Hardening RLS" + architecture_spec §6
   for how to enable it post-launch. SPA chrome is the third (cosmetic) layer.
6. **TypeScript strict, ESM, module layout `modules/{name}/{routes,service,events}.ts`** + an `index.ts` barrel.
7. **The AI layer is never in a write path.** `ai-gateway` emits drafts/suggestions; only a human Save calls the
   registry publish endpoint.
8. **Visual tokens are fixed.** Build views against the Tailwind theme / CSS variables; the `visual_spec.md`
   Banned List (no gradients, 2px radius only, no soft shadows, one accent, RAG = color+shape+word) is build-blocking.
9. **No localhost.** Config from env, relative API paths, production build artifacts only.

---

## Scripts

Run at `server/` (or via the root with `npm run <name>` which delegates to the workspace):

| Script | What it does |
|---|---|
| `npm run build` | `prisma generate` + `tsc` (server). Root `npm run build` also builds the web bundle. |
| `npm run migrate` | `prisma migrate deploy` — applies migrations to the live DB (a Coolify release step). |
| `npm run seed` | Idempotent seed: app_settings, admin user (`ADMIN_EMAIL`/`ADMIN_PASSWORD`), the 12-step INFERRED process. |
| `npm start` | `node dist/index.js` — the runtime entry point. |
| `npm run typecheck` | `tsc --noEmit`. |

> No dev-server script is provided on purpose (Rule 1). Vite is used as a build tool only.

---

## The seed (INFERRED draft)

`npm run seed` loads the cross-border IMMEX import process (MX←US) as **one process, `status=draft`, every step
`confidence=INFERRED`** — a domain-derived hypothesis built to be **corrected by a real operator** (that
correction is the product's intended use). It encodes the real structure: the Step 8 **semáforo branch**
(VERDE → step 10 / ROJO → step 9) and the Step 6 → Step 5 **rework loop**, plus the nine responsible parties.
RAG status is left `unknown` until the registry recomputes it. The seed is idempotent (safe to re-run).

See `DEPLOY_RUNBOOK.md` for the full first-deploy procedure.

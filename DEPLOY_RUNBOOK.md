# Deploy Runbook — Customs Control Tower (Coolify / VPS)

The final ~10-minute human deploy. Every environment is **live** (Rule 1): there is no localhost step. This
runbook is the procedure the deploy stage follows once `deployment_config.md` is complete and
`config_confirmed: true` and the audit shows 0 blockers.

> **Precondition (HARD STOP):** `deployment_config.md` must have NO `<<REQUIRED>>` placeholders left. Secrets
> (DB password, `SESSION_SECRET`, `ANTHROPIC_API_KEY`) are owner-supplied and set in Coolify only —
> never committed, never written into any tracked record.

---

## 0. What you are creating

Default (`STORAGE_DRIVER=fs`):
- **2 containers:** `cct-app` (Fastify + React build), `cct-postgres` (PostgreSQL 16).
- **2 persistent volumes:** `postgres-data`, and `documents-objects` mounted **into the app** at `/data/documents`
  for document bytes. **Mandatory** — without it, uploaded documents vanish on every redeploy (Coolify recreates
  the app container each deploy).

Optional (`STORAGE_DRIVER=s3`): add a 3rd container `cct-minio` (or point `S3_*` at external S3/R2) — see §2.

The `docker-compose.yml` in this folder is the deployment descriptor; Coolify can consume it directly, or you
create the services individually and point the app at the DB by its internal service hostname.

---

## 1. Create the Postgres service (`cct-postgres`)

1. In the Coolify project `customs-control-tower`, add a **PostgreSQL 16** service named `cct-postgres`.
2. Set `POSTGRES_DB=customs_control_tower`, `POSTGRES_USER=cct_app`, and a strong `POSTGRES_PASSWORD` (generate
   in Coolify — this is the `db_password` secret).
3. Attach the named volume `postgres-data` to `/var/lib/postgresql/data`.
4. Note the internal service hostname (e.g. `cct-postgres`). Your `DATABASE_URL` is:
   `postgres://cct_app:<password>@cct-postgres:5432/customs_control_tower`.

## 2. Set up document storage

**Default — disk volume (`STORAGE_DRIVER=fs`), simplest:**
1. On the `cct-app` application in Coolify, add a **Persistent Storage** mount: name `documents-objects`, mount path
   `/data/documents`.
2. Set app env `STORAGE_DRIVER=fs` and `DOCUMENTS_DIR=/data/documents` (both are the defaults).
3. That's it — no extra service, no keys, no bucket. Back up the volume as part of normal VPS backups.

**Optional — S3-compatible (`STORAGE_DRIVER=s3`), for scale / external storage later:**
1. Either deploy MinIO (uncomment the `cct-minio` service in `docker-compose.yml`, or add it as a Docker Compose
   resource): image `minio/minio`, command `server /data --console-address ":9001"`, `MINIO_ROOT_USER`=`S3_ACCESS_KEY`,
   `MINIO_ROOT_PASSWORD`=`S3_SECRET_KEY`, volume `documents-objects`→`/data`, then create the bucket `cct-documents`;
   **or** point `S3_*` at an external S3 / Cloudflare R2 bucket.
2. Set app env `STORAGE_DRIVER=s3`, `S3_ENDPOINT` (e.g. `http://cct-minio:9000`), `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
   `S3_BUCKET=cct-documents`, `S3_FORCE_PATH_STYLE=true`. **No code change** — the switch is purely env.

## 3. Create the app (`cct-app`)

1. Add an **Application** named `cct-app`, source = the GitHub repo (`git_repo`), branch `main`, Dockerfile build
   using this folder's `Dockerfile`.
2. Set ALL environment variables from `.env.example` with real values:
   - `NODE_ENV=production`, `PORT=8080`, `PUBLIC_BASE_URL=https://<your domain>`, `DEFAULT_LOCALE=es`.
   - `DATABASE_URL` (from step 1).
   - `SESSION_SECRET` — 32+ random bytes: `openssl rand -hex 32`.
   - `STORAGE_DRIVER=fs`, `DOCUMENTS_DIR=/data/documents` (default disk storage; see §2). For S3 instead, set
     `STORAGE_DRIVER=s3` + the `S3_*` vars.
   - `ANTHROPIC_API_KEY` (Coolify secret), `INTERVIEW_MODEL=claude-opus-4-8`, `FRESHNESS_MODEL=claude-haiku-4-5`.
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD` (used once by the seed; rotate the password after first login).
3. Add the **Persistent Storage** mount from §2 (`/data/documents`). Expose port `8080`. Attach the domain; enable
   SSL (Coolify / Let's Encrypt).

## 4. Run migrations against the live DB

From a Coolify **release/command** step on `cct-app` (or an exec shell in the container):

```bash
npm run migrate     # prisma migrate deploy — applies 0001_init then 0002_constraints_rls
```

This creates every table, the enums, the `handoffs` branch/loop condition CHECK, the document canonical-term
CHECK, the partial unique index on `steps(process_id, sequence_index)` (non-archived), and the RLS policies
(viewer = SELECT-only; `audit_events` append-only).

## 5. Seed the initial data

```bash
npm run seed        # idempotent: app_settings, admin user, the 12-step INFERRED draft process
```

The seed creates the admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD` and loads the IMMEX import process as a
**draft / INFERRED** map (semáforo branch + Step 6→5 loop included). Re-running is safe (no duplicates).

## 6. Verify

1. `GET https://<domain>/healthz` → `{"status":"ok"}`.
2. `GET https://<domain>/readyz` → `{"status":"ready"}` (confirms DB reachable).
3. Open `https://<domain>/` → the SPA shell loads and the API status line shows `healthz · ok`.
4. Log in with the admin credentials at the login view (built by Builder C).

---

## Hardening RLS (post-launch — required before claiming RLS is active)

**Status today:** the app connects as `cct_app`, the table owner, which **bypasses RLS**. So as shipped, RLS is
**authored but inert** — the enforced authorization control is the app-layer `requireRole` middleware on every
write route (verified: a viewer cannot reach any write route). The only DB-level control active regardless is
`audit_events` append-only (UPDATE/DELETE revoked from `cct_app`). Do **not** describe RLS as active until the
steps below are done and verified on staging.

To make RLS a real second layer:

1. **Provision a non-owner role.** Create `cct_rls` (not the table owner): `GRANT SELECT, INSERT, UPDATE, DELETE`
   on the app tables; do **not** grant ownership. Point the app's `DATABASE_URL` at `cct_rls`.
2. **Force RLS.** In `0002_constraints_rls` (or a new corrective migration — never edit an applied one) uncomment
   the `ALTER TABLE … FORCE ROW LEVEL SECURITY;` line so RLS binds the connecting role too.
3. **Set the per-request GUCs.** Add a Fastify hook (after `attachSession`, before any query) that runs, per
   request: `SET LOCAL app.current_role = '<role>'` and `SET LOCAL app.current_user_id = '<user_id>'` from
   `request.session`. With no session the policy helpers default to `viewer` (SELECT-only) — fail-safe. (This hook
   is intentionally NOT shipped enabled: it is security-critical and cannot be verified without a live DB; enabling
   it untested risks locking the app out of its own tables.)
4. **Verify on staging first** (`staging.<domain>`, a second live env — never localhost): a viewer session cannot
   write any table; an editor can; `audit_events` rejects UPDATE/DELETE. Only then promote to production.

The `audit_events` UPDATE/DELETE revoke applies to `cct_app` regardless of the above.

---

## Rollback

Coolify keeps prior deployments. To roll back: redeploy the previous image. Migrations are forward-only; a bad
migration is fixed with a new corrective migration (never by editing an applied one). Data in `postgres-data`
and `documents-objects` survives app redeploys.

---

## After go-live (real users / real data)

Per Rule 1, changes then deploy to a **staging app on the same VPS** (`staging.<domain>`, its own Coolify app
with its own DB/bucket), are tested there, and only then promoted to production. Staging is still live — it is a
second live environment, not localhost.

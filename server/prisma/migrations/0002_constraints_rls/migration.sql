-- 0002 — application-level constraints + Postgres Row-Level Security.
-- These encode invariants the Prisma schema cannot express (CHECKs, partial unique index) and the
-- defense-in-depth security layer (RLS) the architecture spec requires from day one (§6, §3 conventions).
--
-- RLS model:
--   * The app connects as the table owner (cct_app) which BYPASSES RLS by default. RLS here is the
--     belt-and-suspenders layer for any non-owner role and documents the policy intent. To make RLS
--     actually bite for the app role, the deploy can run the app under a role with rls FORCED (see the
--     FORCE ROW LEVEL SECURITY lines, commented, and DEPLOY_RUNBOOK.md "Hardening RLS").
--   * Per-request the app sets two GUCs: app.current_role ('editor'|'viewer'|'admin') and app.current_user_id.
--   * viewer => SELECT only. editor/admin => full DML. audit_events => append-only for everyone (no UPDATE/DELETE).

-- ============================================================================
-- CHECK constraints (invariants from architecture_spec §3.1)
-- ============================================================================

-- branch/loop handoffs require a Spanish condition label.
ALTER TABLE "handoffs"
  ADD CONSTRAINT "handoffs_condition_required_for_branch_loop"
  CHECK ("kind" NOT IN ('branch', 'loop') OR "condition_es" IS NOT NULL);

-- A document must carry at least one canonical term (ES or EN).
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_canonical_term_present"
  CHECK ("canonical_term_es" IS NOT NULL OR "canonical_term_en" IS NOT NULL);

-- soon_days/stale_days etc. are validated in app code (app_settings JSONB).

-- ============================================================================
-- Partial unique index — sequence_index unique per process among NON-archived steps.
-- (Archived steps may share an index with a live one; only live rows must be unique.)
-- ============================================================================
CREATE UNIQUE INDEX "steps_process_sequence_unique_active"
  ON "steps" ("process_id", "sequence_index")
  WHERE "is_archived" = false;

-- ============================================================================
-- Row-Level Security
-- ============================================================================

-- Helper: read the per-request role/user from session GUCs (NULL-safe).
CREATE OR REPLACE FUNCTION app_current_role() RETURNS text AS $$
  SELECT COALESCE(NULLIF(current_setting('app.current_role', true), ''), 'viewer');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_is_writer() RETURNS boolean AS $$
  SELECT app_current_role() IN ('editor', 'admin');
$$ LANGUAGE sql STABLE;

-- Domain + registry + AI tables: writers (editor/admin) get full DML; everyone authenticated may SELECT.
DO $$
DECLARE
  t text;
  rls_tables text[] := ARRAY[
    'processes', 'steps', 'handoffs', 'responsible_parties', 'io_items',
    'step_io', 'step_documents', 'documents',
    'process_drafts', 'freshness_reports', 'ai_runs',
    'app_settings', 'event_outbox', 'users', 'user_sessions'
  ];
BEGIN
  FOREACH t IN ARRAY rls_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    -- EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t); -- uncomment to enforce against the app/owner role

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (true);', t || '_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (app_is_writer()) WITH CHECK (app_is_writer());',
      t || '_write', t
    );
  END LOOP;
END $$;

-- audit_events: APPEND-ONLY. Enable RLS; allow SELECT to all and INSERT to all; NO update/delete policy
-- exists, so under RLS those operations are denied. (Belt: revoke UPDATE/DELETE from the app role too.)
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_events_select" ON "audit_events";
CREATE POLICY "audit_events_select" ON "audit_events" FOR SELECT USING (true);
DROP POLICY IF EXISTS "audit_events_insert" ON "audit_events";
CREATE POLICY "audit_events_insert" ON "audit_events" FOR INSERT WITH CHECK (true);
-- (Intentionally no UPDATE or DELETE policy — append-only.)

-- Belt-and-suspenders at the privilege level for the app role (no-op if the role differs at deploy time).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cct_app') THEN
    REVOKE UPDATE, DELETE ON "audit_events" FROM cct_app;
  END IF;
END $$;

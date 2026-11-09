-- Dramasaku Studio CP-002 — PostgreSQL 17, forward-only baseline migration.
-- Run through the migration CLI with an application-owned DB role. No provider calls.
-- All monetary amounts are minor units (BIGINT); currency is pinned per plan/run.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_subject text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organization_memberships (
  org_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES app_users(id),
  role text NOT NULL CHECK (role IN ('owner','admin','producer','reviewer','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,user_id)
);
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,org_id)
);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org_id);

CREATE TABLE IF NOT EXISTS production_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  version integer NOT NULL CHECK(version >= 1),
  story_version_id uuid NOT NULL,
  skill_version_id uuid NOT NULL,
  plan_hash char(64) NOT NULL CHECK(plan_hash ~ '^[0-9a-f]{64}$'),
  policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  capability_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','rejected')),
  reserve_cap_minor bigint NOT NULL CHECK(reserve_cap_minor >= 0),
  currency char(3) NOT NULL,
  quote_expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES app_users(id),
  approved_by uuid REFERENCES app_users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,version),
  UNIQUE(id,org_id),
  FOREIGN KEY(project_id,org_id) REFERENCES projects(id,org_id),
  CHECK((status = 'approved') = (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_plans_project ON production_plans(org_id,project_id,status);
CREATE OR REPLACE FUNCTION forbid_mutation_of_approved_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'approved' THEN
    RAISE EXCEPTION 'approved production plans are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS approved_plan_immutable ON production_plans;
CREATE TRIGGER approved_plan_immutable BEFORE UPDATE OR DELETE ON production_plans
FOR EACH ROW EXECUTE FUNCTION forbid_mutation_of_approved_plan();

CREATE TABLE IF NOT EXISTS approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  target_plan_hash char(64) NOT NULL,
  actor_id uuid NOT NULL REFERENCES app_users(id),
  decision text NOT NULL CHECK(decision IN ('approved','rejected')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(plan_id,org_id) REFERENCES production_plans(id,org_id)
);

CREATE OR REPLACE FUNCTION forbid_approval_decision_update_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'approval_decisions is append-only' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS approval_decision_immutable ON approval_decisions;
CREATE TRIGGER approval_decision_immutable BEFORE UPDATE OR DELETE ON approval_decisions
FOR EACH ROW EXECUTE FUNCTION forbid_approval_decision_update_delete();

CREATE TABLE IF NOT EXISTS production_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  plan_hash char(64) NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK(status IN
    ('draft','awaiting_approval','scheduled','running','paused','awaiting_review','completed','failed','canceled')),
  requested_by uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  ended_at timestamptz,
  UNIQUE(id,org_id),
  FOREIGN KEY(plan_id,org_id) REFERENCES production_plans(id,org_id),
  FOREIGN KEY(project_id,org_id) REFERENCES projects(id,org_id)
);
CREATE INDEX IF NOT EXISTS idx_runs_org_status ON production_runs(org_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS run_budget_accounts (
  run_id uuid PRIMARY KEY REFERENCES production_runs(id),
  org_id uuid NOT NULL,
  cap_minor bigint NOT NULL CHECK(cap_minor >= 0),
  held_minor bigint NOT NULL DEFAULT 0 CHECK(held_minor >= 0),
  confirmed_minor bigint NOT NULL DEFAULT 0 CHECK(confirmed_minor >= 0),
  currency char(3) NOT NULL,
  blocked_reason text,
  row_version bigint NOT NULL DEFAULT 0,
  FOREIGN KEY(run_id,org_id) REFERENCES production_runs(id,org_id)
);

CREATE TABLE IF NOT EXISTS provider_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  provider_key text NOT NULL,
  model_key text NOT NULL,
  capability_version text NOT NULL,
  max_reserve_minor bigint NOT NULL CHECK(max_reserve_minor >= 0),
  verified_by uuid NOT NULL REFERENCES app_users(id),
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK(expires_at > verified_at),
  enabled boolean NOT NULL DEFAULT false,
  evidence_ref text NOT NULL,
  UNIQUE(org_id,provider_key,model_key,capability_version)
);

CREATE TABLE IF NOT EXISTS budget_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES production_runs(id),
  reservation_key text NOT NULL,
  node_key text NOT NULL,
  capability_id uuid NOT NULL REFERENCES provider_capabilities(id),
  amount_minor bigint NOT NULL CHECK(amount_minor >= 0),
  actual_minor bigint CHECK(actual_minor >= 0),
  state text NOT NULL DEFAULT 'held' CHECK(state IN ('held','settled','released')),
  submission_state text NOT NULL DEFAULT 'reserved' CHECK(submission_state IN ('reserved','submitting','submitted','unknown','reconciled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE(run_id,reservation_key),
  CHECK ((state='settled') = (actual_minor IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_reservations_run_state ON budget_reservations(run_id,state,submission_state);

CREATE TABLE IF NOT EXISTS usage_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES production_runs(id),
  reservation_id uuid REFERENCES budget_reservations(id),
  entry_type text NOT NULL CHECK(entry_type IN ('hold','settle','release','correction')),
  delta_held_minor bigint NOT NULL DEFAULT 0,
  delta_confirmed_minor bigint NOT NULL DEFAULT 0,
  actor_type text NOT NULL CHECK(actor_type IN ('user','system','provider')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION forbid_ledger_update_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'usage_ledger is append-only' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS ledger_immutable ON usage_ledger;
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON usage_ledger
FOR EACH ROW EXECUTE FUNCTION forbid_ledger_update_delete();

CREATE TABLE IF NOT EXISTS api_idempotency_keys (
  org_id uuid NOT NULL REFERENCES organizations(id),
  idem_key text NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  run_id uuid REFERENCES production_runs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,idem_key)
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  event_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','published','dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON outbox_events(id) WHERE status IN ('pending','processing');

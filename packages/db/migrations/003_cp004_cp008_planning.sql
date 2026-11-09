-- CP004-008 proposed production schema; reviewed but NOT executed against PostgreSQL here.
-- Tenant scope and immutability. Never store API keys in these tables.
CREATE TABLE IF NOT EXISTS story_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  version integer NOT NULL CHECK (version>0),
  screenplay text NOT NULL CHECK (length(screenplay) BETWEEN 12 AND 24000),
  story_hash char(64) NOT NULL CHECK (story_hash ~ '^[0-9a-f]{64}$'),
  dialogue_hash char(64) NOT NULL CHECK (dialogue_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,org_id), UNIQUE(project_id,version),
  FOREIGN KEY(project_id,org_id) REFERENCES projects(id,org_id)
);
CREATE TABLE IF NOT EXISTS dna_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  version integer NOT NULL CHECK (version>0),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  canonical_json jsonb NOT NULL,
  approved_by uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,org_id), UNIQUE(project_id,version),
  FOREIGN KEY(project_id,org_id) REFERENCES projects(id,org_id)
);
CREATE TABLE IF NOT EXISTS workflow_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  stable_key text NOT NULL CHECK (length(stable_key) BETWEEN 1 AND 256),
  type text NOT NULL CHECK (type IN ('STORY_PARSE','DNA_LOCK','SHOT_PLAN','IMAGE_GENERATE','I2V_COMPILE','VIDEO_GENERATE','QA_EVALUATE','TAKE_SELECT','EXPORT_PACKAGE')),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  execution_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_contract jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,plan_id), UNIQUE(plan_id,stable_key),
  FOREIGN KEY(plan_id,org_id) REFERENCES production_plans(id,org_id)
);
CREATE TABLE IF NOT EXISTS workflow_edges (
  plan_id uuid NOT NULL REFERENCES production_plans(id),
  from_node_id uuid NOT NULL,
  to_node_id uuid NOT NULL,
  PRIMARY KEY(plan_id,from_node_id,to_node_id),
  CHECK(from_node_id<>to_node_id),
  FOREIGN KEY(from_node_id,plan_id) REFERENCES workflow_nodes(id,plan_id),
  FOREIGN KEY(to_node_id,plan_id) REFERENCES workflow_nodes(id,plan_id)
);
CREATE TABLE IF NOT EXISTS shot_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  shot_key text NOT NULL CHECK(length(shot_key) BETWEEN 1 AND 128),
  story_version_id uuid NOT NULL,
  dna_version_id uuid NOT NULL,
  input_hash char(64) NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'),
  shot_spec jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,org_id),UNIQUE(plan_id,shot_key),
  FOREIGN KEY(project_id,org_id) REFERENCES projects(id,org_id),
  FOREIGN KEY(plan_id,org_id) REFERENCES production_plans(id,org_id),
  FOREIGN KEY(story_version_id,org_id) REFERENCES story_versions(id,org_id),
  FOREIGN KEY(dna_version_id,org_id) REFERENCES dna_versions(id,org_id)
);
CREATE TABLE IF NOT EXISTS quality_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  asset_version_id uuid NOT NULL,
  evaluator_version text NOT NULL,
  rubric_version text NOT NULL,
  score numeric(5,2) CHECK(score BETWEEN 0 AND 100),
  critical_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(asset_version_id,org_id) REFERENCES video_asset_versions(id,org_id)
);
CREATE TABLE IF NOT EXISTS take_approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  asset_version_id uuid NOT NULL,
  shot_version_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES app_users(id),
  plan_hash char(64) NOT NULL CHECK(plan_hash ~ '^[0-9a-f]{64}$'),
  decision text NOT NULL CHECK(decision IN ('approved','rejected','exception')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(asset_version_id,org_id) REFERENCES video_asset_versions(id,org_id),
  FOREIGN KEY(shot_version_id,org_id) REFERENCES shot_versions(id,org_id)
);
CREATE TABLE IF NOT EXISTS export_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  run_id uuid NOT NULL,
  selection_hash char(64) NOT NULL CHECK(selection_hash ~ '^[0-9a-f]{64}$'),
  manifest_json jsonb NOT NULL,
  signed_off_by uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(run_id,org_id) REFERENCES production_runs(id,org_id),
  UNIQUE(id,org_id)
);
CREATE TABLE IF NOT EXISTS render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  export_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','ready','failed','canceled')),
  output_asset_key text,
  output_sha256 char(64) CHECK(output_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(id,org_id),
  FOREIGN KEY(export_id,org_id) REFERENCES export_packages(id,org_id)
);
CREATE TABLE IF NOT EXISTS publishing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  platform text NOT NULL,
  account_ref text NOT NULL,
  final_render_id uuid NOT NULL,
  release_approval_actor uuid NOT NULL REFERENCES app_users(id),
  idempotency_hash char(64) NOT NULL CHECK(idempotency_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','authorized','submitting','submission_unknown','published','failed')),
  external_post_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,idempotency_hash),
  FOREIGN KEY(final_render_id,org_id) REFERENCES render_jobs(id,org_id)
);
CREATE TABLE IF NOT EXISTS provider_credential_refs (
  org_id uuid NOT NULL REFERENCES organizations(id),
  slot text NOT NULL CHECK(slot IN ('story_llm','image','video','voice','publishing')),
  secret_ref text NOT NULL CHECK(length(secret_ref) BETWEEN 12 AND 512),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,slot)
);
-- Append-only version / approval data: updates only by inserting new versions.
CREATE OR REPLACE FUNCTION cp004_forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'version/decision immutable' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS story_versions_immutable ON story_versions;
CREATE TRIGGER story_versions_immutable BEFORE UPDATE OR DELETE ON story_versions FOR EACH ROW EXECUTE FUNCTION cp004_forbid_change();
DROP TRIGGER IF EXISTS dna_versions_immutable ON dna_versions;
CREATE TRIGGER dna_versions_immutable BEFORE UPDATE OR DELETE ON dna_versions FOR EACH ROW EXECUTE FUNCTION cp004_forbid_change();
DROP TRIGGER IF EXISTS shot_versions_immutable ON shot_versions;
CREATE TRIGGER shot_versions_immutable BEFORE UPDATE OR DELETE ON shot_versions FOR EACH ROW EXECUTE FUNCTION cp004_forbid_change();
DROP TRIGGER IF EXISTS quality_evaluations_immutable ON quality_evaluations;
CREATE TRIGGER quality_evaluations_immutable BEFORE UPDATE OR DELETE ON quality_evaluations FOR EACH ROW EXECUTE FUNCTION cp004_forbid_change();
DROP TRIGGER IF EXISTS take_approval_decisions_immutable ON take_approval_decisions;
CREATE TRIGGER take_approval_decisions_immutable BEFORE UPDATE OR DELETE ON take_approval_decisions FOR EACH ROW EXECUTE FUNCTION cp004_forbid_change();
DROP TRIGGER IF EXISTS export_packages_immutable ON export_packages;
CREATE TRIGGER export_packages_immutable BEFORE UPDATE OR DELETE ON export_packages FOR EACH ROW EXECUTE FUNCTION cp004_forbid_change();

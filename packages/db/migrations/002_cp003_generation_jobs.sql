-- CP-003 durable, deliberately conservative generation queue.
-- A 'submitting' POST that loses its response is NEVER requeued automatically.
ALTER TABLE budget_reservations ADD CONSTRAINT budget_reservations_id_run_unique UNIQUE (id, run_id);

CREATE TABLE generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  run_id uuid NOT NULL,
  reservation_id uuid NOT NULL UNIQUE,
  node_key text NOT NULL CHECK (length(node_key) BETWEEN 1 AND 256),
  provider_key text NOT NULL,
  model_key text NOT NULL,
  input_snapshot jsonb NOT NULL,
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','submitting','submitted','polling','submission_unknown','ready','provider_rejected','provider_failed_unsettled')),
  external_task_id text,
  poll_after timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  error_code text,
  poll_errors integer NOT NULL DEFAULT 0 CHECK (poll_errors>=0),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(run_id,org_id) REFERENCES production_runs(id,org_id),
  FOREIGN KEY(reservation_id,run_id) REFERENCES budget_reservations(id,run_id),
  CHECK ((state IN ('submitted','polling','ready','provider_failed_unsettled')) = (external_task_id IS NOT NULL))
);
CREATE UNIQUE INDEX uq_gen_provider_task ON generation_jobs(provider_key, external_task_id) WHERE external_task_id IS NOT NULL;
CREATE INDEX idx_gen_queued ON generation_jobs(created_at) WHERE state='queued';
CREATE INDEX idx_gen_poll ON generation_jobs(poll_after) WHERE state IN ('submitted','polling');

CREATE TABLE video_asset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  job_id uuid NOT NULL UNIQUE REFERENCES generation_jobs(id),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key text NOT NULL CHECK(length(storage_key)>0),
  bytes bigint NOT NULL CHECK (bytes > 0),
  width integer CHECK (width > 0),
  height integer CHECK (height > 0),
  duration_seconds numeric(12,3) CHECK (duration_seconds>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,org_id)
);
CREATE OR REPLACE FUNCTION forbid_video_asset_update_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'video asset versions immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER video_asset_versions_immutable BEFORE UPDATE OR DELETE ON video_asset_versions
FOR EACH ROW EXECUTE FUNCTION forbid_video_asset_update_delete();

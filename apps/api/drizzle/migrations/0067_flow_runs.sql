-- Flow run history (n8n-style executions). The walk is stateless, so add a
-- persisted run record: each run + its per-step results + which capture docs it
-- produced. get_flow_step opens a run; submit_flow_capture links the doc to the
-- run's step. Idempotent (drizzle ledger is behind — apply via psql).

CREATE TABLE IF NOT EXISTS flow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  flow_id uuid NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  flow_version_id uuid REFERENCES flow_versions(id) ON DELETE SET NULL,
  flow_slug text NOT NULL,
  flow_name text NOT NULL,
  total_steps integer NOT NULL DEFAULT 0,
  captured_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  started_by uuid REFERENCES users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT flow_runs_status_check CHECK (status IN ('running', 'completed', 'abandoned'))
);
CREATE INDEX IF NOT EXISTS flow_runs_flow_idx ON flow_runs(flow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS flow_runs_workspace_idx ON flow_runs(workspace_id, started_at DESC);

CREATE TABLE IF NOT EXISTS flow_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
  step_index integer NOT NULL,
  node_id text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  captured_doc_id uuid,
  captured_title text,
  visited_at timestamptz,
  captured_at timestamptz,
  CONSTRAINT flow_run_steps_status_check CHECK (status IN ('pending', 'visited', 'captured'))
);
CREATE UNIQUE INDEX IF NOT EXISTS flow_run_steps_run_step_key ON flow_run_steps(run_id, step_index);

ALTER TABLE flow_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_runs      FORCE ROW LEVEL SECURITY;
ALTER TABLE flow_run_steps FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flow_runs_tenant_select ON flow_runs;
DROP POLICY IF EXISTS flow_runs_tenant_insert ON flow_runs;
DROP POLICY IF EXISTS flow_runs_tenant_update ON flow_runs;
DROP POLICY IF EXISTS flow_runs_tenant_delete ON flow_runs;
CREATE POLICY flow_runs_tenant_select ON flow_runs FOR SELECT
  USING (workspace_id = app_current_tenant_id());
CREATE POLICY flow_runs_tenant_insert ON flow_runs FOR INSERT
  WITH CHECK (workspace_id = app_current_tenant_id());
CREATE POLICY flow_runs_tenant_update ON flow_runs FOR UPDATE
  USING (workspace_id = app_current_tenant_id())
  WITH CHECK (workspace_id = app_current_tenant_id());
CREATE POLICY flow_runs_tenant_delete ON flow_runs FOR DELETE
  USING (workspace_id = app_current_tenant_id());

DROP POLICY IF EXISTS flow_run_steps_tenant_select ON flow_run_steps;
DROP POLICY IF EXISTS flow_run_steps_tenant_insert ON flow_run_steps;
DROP POLICY IF EXISTS flow_run_steps_tenant_update ON flow_run_steps;
DROP POLICY IF EXISTS flow_run_steps_tenant_delete ON flow_run_steps;
CREATE POLICY flow_run_steps_tenant_select ON flow_run_steps FOR SELECT
  USING (EXISTS (SELECT 1 FROM flow_runs WHERE flow_runs.id = flow_run_steps.run_id AND flow_runs.workspace_id = app_current_tenant_id()));
CREATE POLICY flow_run_steps_tenant_insert ON flow_run_steps FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM flow_runs WHERE flow_runs.id = flow_run_steps.run_id AND flow_runs.workspace_id = app_current_tenant_id()));
CREATE POLICY flow_run_steps_tenant_update ON flow_run_steps FOR UPDATE
  USING (EXISTS (SELECT 1 FROM flow_runs WHERE flow_runs.id = flow_run_steps.run_id AND flow_runs.workspace_id = app_current_tenant_id()));
CREATE POLICY flow_run_steps_tenant_delete ON flow_run_steps FOR DELETE
  USING (EXISTS (SELECT 1 FROM flow_runs WHERE flow_runs.id = flow_run_steps.run_id AND flow_runs.workspace_id = app_current_tenant_id()));

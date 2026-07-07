-- Flow run steps: n8n-parity per-step execution data. Stage-2 recorded only the
-- captured doc per step; instruction/doc/decision steps had no persisted result and
-- stayed 'pending' forever. Add the input the model was served and the output it
-- produced, plus optional error + timing, so each node can show an Input/Output panel
-- like n8n's execution view. Idempotent (drizzle ledger is behind — apply via psql).

ALTER TABLE flow_run_steps ADD COLUMN IF NOT EXISTS input       jsonb;
ALTER TABLE flow_run_steps ADD COLUMN IF NOT EXISTS output      jsonb;
ALTER TABLE flow_run_steps ADD COLUMN IF NOT EXISTS error       text;
ALTER TABLE flow_run_steps ADD COLUMN IF NOT EXISTS duration_ms integer;

-- Widen the status domain: 'visited' now actually gets written (get_flow_step marks
-- the served step visited), and a step may end 'skipped' (branch not taken) or 'error'.
ALTER TABLE flow_run_steps DROP CONSTRAINT IF EXISTS flow_run_steps_status_check;
ALTER TABLE flow_run_steps ADD  CONSTRAINT flow_run_steps_status_check
  CHECK (status IN ('pending', 'visited', 'captured', 'skipped', 'error'));

-- Capture Node Phase 3 fix: widen the flow_nodes.kind CHECK constraint to allow
-- the 'capture' kind. The original constraint (migration 0006_flows_v1.sql) only
-- permitted ('doc','docs','instruction','decision'); the app layer (Phase 1/2/3)
-- accepts 'capture' but the DB rejected the insert with flow_nodes_kind_check.
-- Idempotent: drop-if-exists then re-add (drizzle ledger is behind; apply via psql).

ALTER TABLE flow_nodes DROP CONSTRAINT IF EXISTS flow_nodes_kind_check;
ALTER TABLE flow_nodes ADD CONSTRAINT flow_nodes_kind_check
  CHECK (kind IN ('doc', 'docs', 'instruction', 'decision', 'capture'));

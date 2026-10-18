-- 202610181301_c_realtime_events.sql  (lane c) T-009 [Q11]
-- Polled change feed (ADR-0003, docs/01-architecture.md §2). Rows are HINTS only: {topic, ids}, never
-- record data, so the feed can't leak masked fields. Written in the same tx as the change; pruned after
-- 10 min by the tick through realtime_prune_events().
CREATE TABLE realtime_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  -- Optional audience restriction (e.g. notifications for one user). NULL = whole workspace.
  user_id      uuid,
  topic        text NOT NULL CONSTRAINT realtime_events_topic_check CHECK (topic ~ '^[a-z][a-z_]{0,31}$'),
  ids          uuid[] NOT NULL DEFAULT '{}' CONSTRAINT realtime_events_ids_check CHECK (cardinality(ids) <= 100),
  -- clock_timestamp(), not now(): closest to commit time, which keeps the poll cursor honest.
  occurred_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX realtime_events_workspace_at_idx ON realtime_events (workspace_id, occurred_at);
CREATE INDEX realtime_events_at_idx ON realtime_events (occurred_at);

-- Append-only for the app: no UPDATE/DELETE grants. Pruning goes through the definer function below.
SELECT relay_enable_tenant_rls('realtime_events', 'SELECT, INSERT');

-- The only cross-workspace door for this table: deletes EXPIRED hints across all workspaces (the tick
-- runs without a workspace context). Owner-executed so FORCE RLS doesn't hide other workspaces' rows
-- (owner has BYPASSRLS on Neon / is superuser locally, same as the other definer functions, 06 §3).
CREATE FUNCTION realtime_prune_events(older_than_seconds integer DEFAULT 600)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  n bigint;
BEGIN
  IF older_than_seconds < 60 THEN
    RAISE EXCEPTION 'realtime_prune_events: older_than_seconds must be >= 60';
  END IF;
  DELETE FROM realtime_events WHERE occurred_at < clock_timestamp() - make_interval(secs => older_than_seconds);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
REVOKE ALL ON FUNCTION realtime_prune_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION realtime_prune_events(integer) TO app_user;

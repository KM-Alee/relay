-- 202610181301_a_jobs.sql  (lane a) · T-008 · outbox + scheduler_state + job_runs [Q5] [F3.8]
-- Runs once, in filename order, in ONE transaction, as the owner role. Never edit after merge.
-- Spec: docs/01-architecture.md §6, docs/02-data-model.md §8, docs/04-integrations.md §7, ADR-0002.
--
-- Access model:
--   * app_user sees outbox rows of the workspace in `app.workspace_id` (withWorkspaceTx), and the
--     SYSTEM rows (workspace_id IS NULL) only when no workspace is set (withSystemTx).
--   * The runner claims across workspaces ONLY through the SECURITY DEFINER functions below
--     (owner-owned). Because RLS is FORCED, the owner gets its own permissive policy so those
--     functions can see every row; app_user never matches that policy.
--   * scheduler_state and job_runs are global (no workspace_id, no RLS).

-- ── outbox ───────────────────────────────────────────────────────────────
CREATE TABLE outbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid REFERENCES workspaces (id),          -- NULL = system job (e.g. wake.schedule)
  type          text NOT NULL CONSTRAINT outbox_type_check CHECK (type ~ '^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$'),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'pending'
                CONSTRAINT outbox_status_check CHECK (status IN ('pending', 'in_flight', 'done', 'failed', 'dead')),
  attempts      integer NOT NULL DEFAULT 0 CONSTRAINT outbox_attempts_check CHECK (attempts >= 0),
  max_attempts  integer NOT NULL DEFAULT 6 CONSTRAINT outbox_max_attempts_check CHECK (max_attempts >= 1),
  available_at  timestamptz NOT NULL DEFAULT now(),
  locked_until  timestamptz,                              -- in-flight lease (crash → reclaimed after expiry)
  last_error    text,
  dedupe_key    text UNIQUE,                              -- NULL = no dedupe (04 §7 keys)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  done_at       timestamptz,
  CONSTRAINT outbox_lease_check CHECK (status <> 'in_flight' OR locked_until IS NOT NULL)
);

CREATE INDEX outbox_pending_idx ON outbox (available_at) WHERE status = 'pending';
CREATE INDEX outbox_in_flight_idx ON outbox (locked_until) WHERE status = 'in_flight';
CREATE INDEX outbox_workspace_status_idx ON outbox (workspace_id, status);
CREATE INDEX outbox_finished_idx ON outbox (done_at) WHERE status IN ('done', 'failed', 'dead');

CREATE TRIGGER outbox_updated_at BEFORE UPDATE ON outbox
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox FORCE ROW LEVEL SECURITY;
-- Workspace rows in withWorkspaceTx; system rows (NULL) in withSystemTx (`app.workspace_id` = '').
CREATE POLICY tenant_isolation ON outbox
  USING      (workspace_id IS NOT DISTINCT FROM nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id IS NOT DISTINCT FROM nullif(current_setting('app.workspace_id', true), '')::uuid);
-- The migration owner (= owner of the SECURITY DEFINER functions below) sees all rows.
CREATE POLICY job_runner ON outbox TO CURRENT_USER USING (true) WITH CHECK (true);
-- No DELETE for app_user: finished rows are pruned by relay_outbox_prune().
GRANT SELECT, INSERT, UPDATE ON outbox TO app_user;

-- ── scheduler_state (singleton) ──────────────────────────────────────────
-- The next QStash wake-up we believe is scheduled (dedupe for ensureWakeBy, 03 §6).
CREATE TABLE scheduler_state (
  id                   boolean PRIMARY KEY DEFAULT true CONSTRAINT scheduler_state_singleton CHECK (id),
  next_wake_at         timestamptz,
  qstash_message_id    text,
  last_maintenance_at  timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
INSERT INTO scheduler_state (id) VALUES (true);
CREATE TRIGGER scheduler_state_updated_at BEFORE UPDATE ON scheduler_state
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
GRANT SELECT, UPDATE ON scheduler_state TO app_user;

-- ── job_runs (tick heartbeat) ────────────────────────────────────────────
CREATE TABLE job_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger           text NOT NULL
                    CONSTRAINT job_runs_trigger_check CHECK (trigger IN ('qstash', 'cron', 'after', 'nudge', 'dev', 'judge', 'manual')),
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  duration_ms       integer,
  budget_ms         integer NOT NULL,
  leads_processed   integer NOT NULL DEFAULT 0,
  outbox_processed  integer NOT NULL DEFAULT 0,
  details           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- per-processor counts/errors, wake outcome
  next_wake_at      timestamptz,
  error             text
);
CREATE INDEX job_runs_started_at_idx ON job_runs (started_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON job_runs TO app_user;

-- ── runner functions (SECURITY DEFINER, cross-workspace, return ids/payloads only) ──
-- Claim ≤ p_limit due rows: pending + available, or in_flight with an EXPIRED lease (crashed
-- delivery). Each claim bumps `attempts` (the fencing token for completion) and sets a lease.
-- Expired leases on the final attempt are dead-lettered instead of reclaimed (poison pill).
-- FOR UPDATE SKIP LOCKED: concurrent ticks never claim the same row (F3.8, Q5).
CREATE FUNCTION relay_outbox_claim(
  p_limit integer,
  p_lease_seconds integer,
  p_types text[] DEFAULT NULL,
  p_workspace_ids uuid[] DEFAULT NULL
) RETURNS TABLE (
  id uuid, workspace_id uuid, type text, payload jsonb, attempts integer, max_attempts integer,
  locked_until timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE outbox o
     SET status = 'dead', locked_until = NULL, done_at = now(),
         last_error = left(coalesce(o.last_error || ' | ', '') || 'lease expired on the final attempt', 2000)
   WHERE o.id IN (
     SELECT x.id FROM outbox x
      WHERE x.status = 'in_flight' AND x.locked_until <= now() AND x.attempts >= x.max_attempts
        AND (p_types IS NULL OR x.type = ANY (p_types))
        AND (p_workspace_ids IS NULL OR x.workspace_id = ANY (p_workspace_ids))
      FOR UPDATE SKIP LOCKED);

  RETURN QUERY
  WITH due AS (
    SELECT x.id FROM outbox x
     WHERE ((x.status = 'pending' AND x.available_at <= now())
         OR (x.status = 'in_flight' AND x.locked_until <= now() AND x.attempts < x.max_attempts))
       AND (p_types IS NULL OR x.type = ANY (p_types))
       AND (p_workspace_ids IS NULL OR x.workspace_id = ANY (p_workspace_ids))
     ORDER BY coalesce(x.locked_until, x.available_at), x.id
     LIMIT greatest(p_limit, 0)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE outbox o
     SET status = 'in_flight',
         attempts = o.attempts + 1,
         locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 1))
    FROM due
   WHERE o.id = due.id
  RETURNING o.id, o.workspace_id, o.type, o.payload, o.attempts, o.max_attempts, o.locked_until;
END
$$;

-- Earliest moment any matching row becomes due (pending available_at / in-flight lease expiry).
CREATE FUNCTION relay_outbox_next_due(
  p_types text[] DEFAULT NULL,
  p_workspace_ids uuid[] DEFAULT NULL
) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT min(CASE WHEN o.status = 'pending' THEN o.available_at ELSE o.locked_until END)
    FROM outbox o
   WHERE o.status IN ('pending', 'in_flight')
     AND (p_types IS NULL OR o.type = ANY (p_types))
     AND (p_workspace_ids IS NULL OR o.workspace_id = ANY (p_workspace_ids));
$$;

-- Delete finished rows: done after p_done_seconds, failed/dead after p_dead_seconds (kept longer
-- so Admins can see them). Returns the number of rows deleted.
CREATE FUNCTION relay_outbox_prune(p_done_seconds integer, p_dead_seconds integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM outbox o
   WHERE (o.status = 'done' AND o.done_at < now() - make_interval(secs => p_done_seconds))
      OR (o.status IN ('failed', 'dead') AND o.done_at < now() - make_interval(secs => p_dead_seconds));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

REVOKE ALL ON FUNCTION relay_outbox_claim(integer, integer, text[], uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION relay_outbox_next_due(text[], uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION relay_outbox_prune(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION relay_outbox_claim(integer, integer, text[], uuid[]) TO app_user;
GRANT EXECUTE ON FUNCTION relay_outbox_next_due(text[], uuid[]) TO app_user;
GRANT EXECUTE ON FUNCTION relay_outbox_prune(integer, integer) TO app_user;

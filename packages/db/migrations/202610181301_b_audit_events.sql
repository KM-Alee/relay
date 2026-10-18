-- 202610181301_b_audit_events.sql  (lane b) · T-007 · audit log core (docs/06-security.md §6). [F4.1] [F4.3] [F4.4]
-- Runs once, in filename order, in ONE transaction, as the owner role. Never edit after merge.
--
-- Append-only (F4.3): app_user has SELECT + INSERT only, and triggers reject UPDATE/DELETE/TRUNCATE for
-- every role (the owner too: a deliberate tamper demo must DISABLE the trigger as the table owner).
-- Hash chain (F4.4): a BEFORE INSERT trigger assigns `seq`, `prev_hash` and `hash` per workspace, so no
-- code path can skip or forge it. Inserts are serialized per workspace with a TRANSACTION-level advisory
-- lock (never a session lock: Neon's pooler, ADR-0005).
-- The FK actor_user_id → users is added by the identity migration (users doesn't exist yet).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE audit_actor_type AS ENUM ('user', 'system', 'ai');

CREATE TABLE audit_events (
  id            bigserial PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces (id),
  seq           bigint NOT NULL,                  -- set by audit_chain(); 1, 2, 3 … per workspace
  occurred_at   timestamptz NOT NULL,             -- set by audit_chain() (DB clock) unless provided
  actor_type    audit_actor_type NOT NULL,
  actor_user_id uuid,
  action        text NOT NULL CONSTRAINT audit_events_action_check CHECK (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  target_type   text NOT NULL,
  target_id     text,
  before        jsonb,
  after         jsonb,
  meta          jsonb,
  prev_hash     bytea NOT NULL,                   -- set by audit_chain()
  hash          bytea NOT NULL,                   -- set by audit_chain()
  CONSTRAINT audit_events_ws_seq_key UNIQUE (workspace_id, seq),
  CONSTRAINT audit_events_user_actor_check CHECK (actor_type <> 'user' OR actor_user_id IS NOT NULL)
);
CREATE INDEX audit_events_ws_action_idx ON audit_events (workspace_id, action, seq DESC);
CREATE INDEX audit_events_ws_target_idx ON audit_events (workspace_id, target_type, target_id);

-- Canonical text of a row: jsonb::text normalizes key order → deterministic. The timestamp is rendered
-- in a fixed UTC format so the verifier (same function) reproduces it exactly.
CREATE FUNCTION audit_canonical(r audit_events) RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'ws', r.workspace_id,
    'seq', r.seq,
    'at', to_char(r.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actor_type', r.actor_type,
    'actor', r.actor_user_id,
    'action', r.action,
    'target_type', r.target_type,
    'target', r.target_id,
    'before', r.before,
    'after', r.after,
    'meta', r.meta
  )::text
$$;

-- hash = sha256(prev_hash || utf8(canonical)). Used by the trigger AND by audit.verify().
CREATE FUNCTION audit_row_hash(r audit_events) RETURNS bytea
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT public.digest(r.prev_hash || convert_to(audit_canonical(r), 'UTF8'), 'sha256')
$$;

CREATE FUNCTION audit_chain() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  last record;
BEGIN
  -- Serialize per workspace (transaction-scoped; released at COMMIT/ROLLBACK). In READ COMMITTED each
  -- statement below takes a fresh snapshot, so after the wait it sees the previous committed row.
  PERFORM pg_advisory_xact_lock(hashtext('audit:' || NEW.workspace_id::text));
  SELECT a.seq, a.hash INTO last
    FROM audit_events a
   WHERE a.workspace_id = NEW.workspace_id
   ORDER BY a.seq DESC
   LIMIT 1;
  NEW.seq         := COALESCE(last.seq, 0) + 1;
  NEW.prev_hash   := COALESCE(last.hash, '\x00'::bytea);
  NEW.occurred_at := COALESCE(NEW.occurred_at, now());
  NEW.hash        := audit_row_hash(NEW);
  RETURN NEW;
END
$$;

CREATE FUNCTION audit_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER audit_chain BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_chain();
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_immutable();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_immutable();

-- RLS (ENABLE + FORCE + tenant policy) with SELECT, INSERT only (06 §3, §6).
SELECT relay_enable_tenant_rls('audit_events', 'SELECT, INSERT');
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM app_user, PUBLIC;
GRANT USAGE, SELECT ON SEQUENCE audit_events_id_seq TO app_user;

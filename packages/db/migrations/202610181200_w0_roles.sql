-- W0 · T-002 · runtime role + schema privileges (docs/06-security.md §3, ADR-0005). [Q6] [F1.6]
-- Runs as the OWNER (Neon: neondb_owner) over DATABASE_URL_UNPOOLED. Idempotent.
--
-- app_user: LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE, owns NOTHING.
-- Password: the runner sets `relay.app_db_password` (transaction-local) from APP_DB_PASSWORD.
--   empty  → role is created NOLOGIN (Neon: set the password in the console) / password untouched.
-- Roles are cluster-wide: per-worktree databases share one app_user, so creation tolerates a race.
DO $$
DECLARE
  pw text := nullif(current_setting('relay.app_db_password', true), '');
  r  record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    BEGIN
      IF pw IS NULL THEN
        CREATE ROLE app_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
      ELSE
        EXECUTE format(
          'CREATE ROLE app_user LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION',
          pw);
      END IF;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN
      NULL; -- created concurrently by a migration in another database of the same cluster
    END;
  ELSIF pw IS NOT NULL THEN
    EXECUTE format('ALTER ROLE app_user WITH LOGIN PASSWORD %L', pw);
  END IF;

  -- Never ALTER the attributes (PG16 needs superuser even for NO* forms); assert them instead.
  SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb INTO r FROM pg_roles WHERE rolname = 'app_user';
  IF r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb THEN
    RAISE EXCEPTION 'app_user must be NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB';
  END IF;
END
$$;

-- Schema access. app_user may use objects but never create them.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_user;

-- Sequences created later by the owner are usable by app_user. Table privileges are NOT defaulted:
-- every table grants explicitly (audit_events is SELECT/INSERT only, 06 §6), so a forgotten grant
-- fails closed.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- schema_migrations is runner-internal.
REVOKE ALL ON TABLE schema_migrations FROM PUBLIC;

-- ── Shared helpers for every lane's migrations ───────────────────────────
-- Generic updated_at trigger (02 §0 rule 5):
--   CREATE TRIGGER <t>_updated_at BEFORE UPDATE ON <t> FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Tenant RLS in one call (template: packages/db/sql/templates/tenant-table.sql):
--   SELECT relay_enable_tenant_rls('contacts');                          -- full CRUD for app_user
--   SELECT relay_enable_tenant_rls('lead_events', 'SELECT, INSERT, UPDATE'); -- no DELETE
-- ENABLE + FORCE RLS, policy `tenant_isolation` on workspace_id, and the GRANT to app_user.
-- `nullif(..., '')` matters: after a transaction-local set_config ends, the session value of the
-- placeholder is '' (not NULL), and ''::uuid would raise instead of matching nothing.
CREATE OR REPLACE FUNCTION relay_enable_tenant_rls(
  tbl regclass,
  privs text DEFAULT 'SELECT, INSERT, UPDATE, DELETE'
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF privs !~ '^(SELECT|INSERT|UPDATE|DELETE)(, ?(SELECT|INSERT|UPDATE|DELETE))*$' THEN
    RAISE EXCEPTION 'relay_enable_tenant_rls: invalid privilege list %', privs;
  END IF;
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', tbl);
  EXECUTE format(
    $f$CREATE POLICY tenant_isolation ON %s
         USING      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
         WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)$f$,
    tbl);
  EXECUTE format('GRANT %s ON %s TO app_user', privs, tbl);
END
$$;
REVOKE ALL ON FUNCTION relay_enable_tenant_rls(regclass, text) FROM PUBLIC;

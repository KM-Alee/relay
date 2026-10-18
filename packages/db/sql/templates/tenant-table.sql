-- ─────────────────────────────────────────────────────────────────────────────
-- TEMPLATE: workspace-scoped table (copy into your lane's migration; not applied by the runner).
-- File: packages/db/migrations/<YYYYMMDDHHmm>_<lane>_<slug>.sql   e.g. 202610191030_b_contacts.sql
-- Rules: docs/02-data-model.md §0, docs/06-security.md §3. Reviewer checklist: 06 §8.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE contacts (
  id            uuid PRIMARY KEY,                       -- UUID v7 generated in app (core/ids.ts)
  workspace_id  uuid NOT NULL REFERENCES workspaces (id),
  name          text NOT NULL,
  version       integer NOT NULL DEFAULT 0,             -- optimistic locking for mutable aggregates
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)                             -- children use composite FKs (02 §0 rule 2)
);
-- Child example: FOREIGN KEY (workspace_id, contact_id) REFERENCES contacts (workspace_id, id)

CREATE INDEX contacts_workspace_idx ON contacts (workspace_id);
CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: ENABLE + FORCE + tenant_isolation policy + GRANT to app_user, in one call.
SELECT relay_enable_tenant_rls('contacts');                              -- SELECT, INSERT, UPDATE, DELETE
-- SELECT relay_enable_tenant_rls('lead_events', 'SELECT, INSERT, UPDATE'); -- restricted grants
--
-- Expanded equivalent (if you need a custom policy):
--   ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
--   CREATE POLICY tenant_isolation ON contacts
--     USING      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
--     WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--   GRANT SELECT, INSERT, UPDATE, DELETE ON contacts TO app_user;
--
-- Global tables (no workspace_id, no RLS) instead: plain GRANT of the minimum privileges.

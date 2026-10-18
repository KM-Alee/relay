-- W0 · T-002 · workspaces (docs/02-data-model.md §1). [F1.6]
-- Minimal columns; later lanes ADD columns in their own migrations (never edit this file).
CREATE TABLE workspaces (
  id                       uuid PRIMARY KEY,
  name                     text NOT NULL,
  slug                     text NOT NULL UNIQUE,
  owner_user_id            uuid,              -- FK → users added by the identity migration (T-101)
  default_locale           text NOT NULL DEFAULT 'en' CONSTRAINT workspaces_default_locale_check CHECK (default_locale IN ('en', 'ur')),
  timezone                 text NOT NULL DEFAULT 'Asia/Karachi',
  currency                 char(3) NOT NULL DEFAULT 'PKR',
  default_lead_value_minor bigint,
  time_warp_multiplier     numeric(6, 2) NOT NULL DEFAULT 1 CONSTRAINT workspaces_time_warp_multiplier_check CHECK (time_warp_multiplier > 0),
  demo_mode                boolean NOT NULL DEFAULT false,
  business_hours           jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  version                  integer NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER workspaces_updated_at BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- workspaces is the tenant root: the policy compares `id`, not `workspace_id` (06 §3).
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspaces
  USING      (id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.workspace_id', true), '')::uuid);
-- Signup inserts its new workspace inside withWorkspaceTx(newId). Workspaces are never deleted at runtime.
GRANT SELECT, INSERT, UPDATE ON workspaces TO app_user;

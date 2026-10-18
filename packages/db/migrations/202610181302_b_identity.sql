-- 202610181302_b_identity.sql  (lane b) · T-101/T-102 · users, sessions, roles, permissions
-- (docs/02-data-model.md §1, docs/06-security.md §1–§3, ADR-0004). [F1.1] [F1.3] [F1.6] [F1.7] [F1.8] [Q1]
-- Runs once, in filename order, in ONE transaction, as the owner role. Never edit after merge.
-- Invites (F1.2, T-103) get their own migration.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE user_base_level AS ENUM ('owner', 'admin', 'user');
CREATE TYPE user_availability AS ENUM ('available', 'busy', 'on_leave', 'offline');

-- ── users ──────────────────────────────────────────────────────────────
-- One user = one workspace; email is GLOBALLY unique so login needs no workspace picker (ADR-0004).
-- Users are deactivated, never deleted (F1.8): app_user has no DELETE.
CREATE TABLE users (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspaces (id),
  email          citext NOT NULL CONSTRAINT users_email_key UNIQUE,
  name           text NOT NULL,
  password_hash  text NOT NULL,                       -- argon2id PHC string (params inside)
  base_level     user_base_level NOT NULL,
  availability   user_availability NOT NULL DEFAULT 'available',
  is_active      boolean NOT NULL DEFAULT true,
  deactivated_at timestamptz,
  locale         text NOT NULL DEFAULT 'en' CONSTRAINT users_locale_check CHECK (locale IN ('en', 'ur')),
  timezone       text NOT NULL DEFAULT 'Asia/Karachi',
  capacity       integer CONSTRAINT users_capacity_check CHECK (capacity IS NULL OR capacity > 0),
  skills         text[] NOT NULL DEFAULT '{}',
  slack_user_id  text,
  slack_team_id  text,
  ui_prefs       jsonb NOT NULL DEFAULT '{}'::jsonb,
  version        integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_ws_id_key UNIQUE (workspace_id, id),
  CONSTRAINT users_deactivated_check CHECK (is_active OR deactivated_at IS NOT NULL)
);
CREATE INDEX users_ws_idx ON users (workspace_id);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('users', 'SELECT, INSERT, UPDATE');

-- The workspace owner must be a user OF THAT workspace (composite FK, 02 §0 rule 2).
ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_owner_user_fk FOREIGN KEY (id, owner_user_id) REFERENCES users (workspace_id, id);
-- Audit actors are users of the same workspace.
ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_actor_user_fk FOREIGN KEY (workspace_id, actor_user_id) REFERENCES users (workspace_id, id);

-- ── permissions (F1.3, F1.7) ────────────────────────────────────────────
-- Effective = level_permissions[base_level] ∪ roles' permissions, then overrides (deny wins).
-- Owner always has everything. A missing level row falls back to the code defaults (contracts).
CREATE TABLE level_permissions (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  base_level   user_base_level NOT NULL,
  permissions  text[] NOT NULL DEFAULT '{}',
  version      integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, base_level)
);
CREATE TRIGGER level_permissions_updated_at BEFORE UPDATE ON level_permissions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('level_permissions');

CREATE TABLE roles (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  key          text,                                  -- stable key for seeded roles ('manager'), else NULL
  name         text NOT NULL,
  permissions  text[] NOT NULL DEFAULT '{}',
  is_system    boolean NOT NULL DEFAULT false,
  version      integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_ws_id_key UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX roles_ws_name_key ON roles (workspace_id, lower(name));
CREATE UNIQUE INDEX roles_ws_key_key ON roles (workspace_id, key) WHERE key IS NOT NULL;
CREATE TRIGGER roles_updated_at BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('roles');

CREATE TABLE user_roles (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  user_id      uuid NOT NULL,
  role_id      uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (workspace_id, user_id) REFERENCES users (workspace_id, id),
  FOREIGN KEY (workspace_id, role_id) REFERENCES roles (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX user_roles_ws_role_idx ON user_roles (workspace_id, role_id);
SELECT relay_enable_tenant_rls('user_roles');

CREATE TABLE user_permission_overrides (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  user_id      uuid NOT NULL,
  permission   text NOT NULL,
  effect       text NOT NULL CONSTRAINT user_permission_overrides_effect_check CHECK (effect IN ('grant', 'deny')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission),
  FOREIGN KEY (workspace_id, user_id) REFERENCES users (workspace_id, id)
);
SELECT relay_enable_tenant_rls('user_permission_overrides');

-- ── sessions (06 §1) ────────────────────────────────────────────────────
-- Cookie holds a random 32-byte token; the DB stores only sha256(token). Sliding 7 d idle (last_seen_at,
-- touched at most every 5 min), 30 d absolute (expires_at). rotate_required: set on a privilege change;
-- the next API request issues a new token and revokes this row.
CREATE TABLE sessions (
  id              uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspaces (id),
  user_id         uuid NOT NULL,
  token_hash      bytea NOT NULL CONSTRAINT sessions_token_hash_key UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  rotate_required boolean NOT NULL DEFAULT false,
  ip              inet,
  user_agent      text,
  CONSTRAINT sessions_ws_id_key UNIQUE (workspace_id, id),
  CONSTRAINT sessions_token_hash_len CHECK (octet_length(token_hash) = 32),
  FOREIGN KEY (workspace_id, user_id) REFERENCES users (workspace_id, id)
);
CREATE INDEX sessions_user_live_idx ON sessions (workspace_id, user_id) WHERE revoked_at IS NULL;
SELECT relay_enable_tenant_rls('sessions');

-- ── SECURITY DEFINER doors (06 §3): the ONLY cross-workspace lookups ─────
-- Owned by the migration owner, pinned search_path, EXECUTE for app_user only, minimal columns.

-- Login by email (global): returns the hash for verification in app code.
CREATE FUNCTION auth_find_user_by_email(p_email citext)
RETURNS TABLE (user_id uuid, workspace_id uuid, password_hash text, is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u.id, u.workspace_id, u.password_hash, u.is_active FROM public.users u WHERE u.email = p_email
$$;
REVOKE ALL ON FUNCTION auth_find_user_by_email(citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user_by_email(citext) TO app_user;

-- Every request: valid (not revoked, not past absolute or idle expiry, active user) sessions only.
CREATE FUNCTION auth_resolve_session(p_token_hash bytea)
RETURNS TABLE (
  session_id uuid, user_id uuid, workspace_id uuid, base_level user_base_level, locale text,
  expires_at timestamptz, last_seen_at timestamptz, rotate_required boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT s.id, s.user_id, s.workspace_id, u.base_level, u.locale, s.expires_at, s.last_seen_at, s.rotate_required
    FROM public.sessions s
    JOIN public.users u ON u.workspace_id = s.workspace_id AND u.id = s.user_id
   WHERE s.token_hash = p_token_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
     AND s.last_seen_at > now() - interval '7 days'
     AND u.is_active
$$;
REVOKE ALL ON FUNCTION auth_resolve_session(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_session(bytea) TO app_user;

-- 202610181430_b_invites.sql  (lane b) · T-103 · invitations (docs/02-data-model.md §1, 06-security.md §1). [F1.2]
-- Runs once, in filename order, in ONE transaction, as the owner role. Never edit after merge.
-- Single-use link: only sha256(token) is stored. Accept is an atomic conditional UPDATE (used_at IS NULL ...).
-- No DELETE for app_user: used/expired/revoked invites stay as history.

CREATE TABLE invites (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  token_hash   bytea NOT NULL CONSTRAINT invites_token_hash_key UNIQUE,
  base_level   user_base_level NOT NULL CONSTRAINT invites_level_check CHECK (base_level IN ('admin', 'user')),
  role_id      uuid,
  created_by   uuid NOT NULL,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  used_by      uuid,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invites_token_hash_len CHECK (octet_length(token_hash) = 32),
  CONSTRAINT invites_ws_id_key UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, role_id) REFERENCES roles (workspace_id, id),
  FOREIGN KEY (workspace_id, created_by) REFERENCES users (workspace_id, id),
  FOREIGN KEY (workspace_id, used_by) REFERENCES users (workspace_id, id)
);
CREATE INDEX invites_ws_created_idx ON invites (workspace_id, created_at DESC);
SELECT relay_enable_tenant_rls('invites', 'SELECT, INSERT, UPDATE');

-- Public accept/preview has no session, hence no workspace context: the ONLY cross-workspace lookup,
-- by token hash, minimal columns (06 §3 SECURITY DEFINER doors).
CREATE FUNCTION auth_find_invite(p_token_hash bytea)
RETURNS TABLE (
  invite_id uuid, workspace_id uuid, workspace_name text, base_level user_base_level, role_name text,
  expires_at timestamptz, usable boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT i.id, i.workspace_id, w.name, i.base_level, r.name, i.expires_at,
         (i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now())
    FROM public.invites i
    JOIN public.workspaces w ON w.id = i.workspace_id
    LEFT JOIN public.roles r ON r.workspace_id = i.workspace_id AND r.id = i.role_id
   WHERE i.token_hash = p_token_hash
$$;
REVOKE ALL ON FUNCTION auth_find_invite(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_invite(bytea) TO app_user;

-- 202610181302_c_integrations_core.sql  (lane c) · T-140/T-145 · integrations + Slack tables
-- (docs/02-data-model.md §4 slack_alerts, §8; docs/04-integrations.md §2, §6, §8). [I5.1] [I5.2] [I5.3] [I5.4] [I5.8] [I4.1] [I4.3] [I4.4]
-- Runs once, in filename order, in ONE transaction, as the owner role. Never edit after merge.
--
-- Deliberately NO foreign keys to users / leads: those tables belong to lanes A and B and may not exist
-- when this runs. A follow-up migration adds the composite FKs (workspace_id, user_id) once both are merged.
-- Everything here references only `workspaces`.

-- ── integration_connections ─────────────────────────────────────────────
-- One row per (workspace, provider) [or per (workspace, provider, user) for Google]. Secrets are an
-- AES-256-GCM envelope string (core/secrets.ts, AAD = row id), decrypted only inside job/service code.
CREATE TABLE integration_connections (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspaces (id),
  user_id        uuid,                                 -- per-employee connections (Google Calendar, I3.1)
  provider       text NOT NULL
                 CONSTRAINT integration_connections_provider_check
                 CHECK (provider IN ('meta_whatsapp', 'twilio_whatsapp', 'stripe', 'google_calendar', 'slack', 'openai')),
  status         text NOT NULL DEFAULT 'not_connected'
                 CONSTRAINT integration_connections_status_check
                 CHECK (status IN ('not_connected', 'connected', 'error', 'needs_reconnect')),
  -- Random routing token in webhook URLs. NOT a secret: authenticity comes from the provider signature.
  connection_key text NOT NULL CONSTRAINT integration_connections_key_key UNIQUE
                 CONSTRAINT integration_connections_key_shape CHECK (connection_key ~ '^[a-z0-9]{24}$'),
  public_config  jsonb NOT NULL DEFAULT '{}'::jsonb,   -- non-secret config (phone number id, Slack team id…)
  secrets_enc    text,                                 -- v1.<keyId>.<b64url> envelope, JSON of {field: value}
  secrets_hint   text,                                 -- last 4 chars of the primary secret
  last_ok_at     timestamptz,
  last_error_at  timestamptz,
  last_error     text,                                 -- short, redacted
  -- Circuit breaker (I5.8): {state:'closed'|'open'|'half_open', failures:int, opened_at: iso|null}
  health         jsonb NOT NULL DEFAULT '{"state":"closed","failures":0,"opened_at":null}'::jsonb,
  version        integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_connections_ws_id_key UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX integration_connections_ws_provider_key
  ON integration_connections (workspace_id, provider) WHERE user_id IS NULL;
CREATE UNIQUE INDEX integration_connections_ws_provider_user_key
  ON integration_connections (workspace_id, provider, user_id) WHERE user_id IS NOT NULL;
CREATE TRIGGER integration_connections_updated_at BEFORE UPDATE ON integration_connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- No DELETE: disconnecting wipes the secrets and sets status (the sync history keeps its reference).
SELECT relay_enable_tenant_rls('integration_connections', 'SELECT, INSERT, UPDATE');

-- ── integration_events: webhook inbox + outbound call log = "sync history" (I5.4) ──────────
-- workspace_id is NULL for events that could not be attributed to a workspace (unknown connection key,
-- platform-default Slack app before its payload is resolved). Those rows are visible only to
-- withSystemTx (app.workspace_id = '') and to the definer functions below.
CREATE TABLE integration_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid REFERENCES workspaces (id),
  connection_id     uuid,
  provider          text NOT NULL,
  direction         text NOT NULL CONSTRAINT integration_events_direction_check CHECK (direction IN ('in', 'out')),
  kind              text NOT NULL,                       -- e.g. 'slack.command', 'slack.interaction', 'slack.chat.postMessage'
  external_event_id text,                                -- provider event id: dedupe key for inbound
  status            text NOT NULL DEFAULT 'received'
                    CONSTRAINT integration_events_status_check
                    CHECK (status IN ('received', 'processed', 'rejected', 'failed', 'ignored')),
  duplicate_count   integer NOT NULL DEFAULT 0,
  http_status       integer,
  latency_ms        integer,
  reference         text,                                -- wamid / Stripe id / Google event id / Slack message ts
  payload_redacted  jsonb,                               -- PII-minimal summary (04 §2), never the raw body
  payload_hash      text,                                -- sha256 of the raw body (hex): proof without storing it
  normalized        jsonb,                               -- parsed event, for replay (I5.9)
  error             text,
  ai_tokens_in      integer,                             -- AI usage (T-204); NULL for other providers
  ai_tokens_out     integer,
  ai_cost_micros    bigint,
  prompt_version    text,
  replay_of         uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz
);
-- Idempotency (I1.8, I2.4, I4.3): one inbound row per provider event, globally. Duplicates bump duplicate_count.
CREATE UNIQUE INDEX integration_events_inbound_key
  ON integration_events (provider, external_event_id) WHERE direction = 'in' AND external_event_id IS NOT NULL;
CREATE INDEX integration_events_ws_created_idx ON integration_events (workspace_id, created_at DESC);
CREATE INDEX integration_events_ws_provider_status_idx
  ON integration_events (workspace_id, provider, status, created_at DESC);

ALTER TABLE integration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON integration_events
  USING      (workspace_id IS NOT DISTINCT FROM nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id IS NOT DISTINCT FROM nullif(current_setting('app.workspace_id', true), '')::uuid);
-- The migration owner (= owner of the SECURITY DEFINER functions below) sees all rows.
CREATE POLICY definer_access ON integration_events TO CURRENT_USER USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON integration_events TO app_user;

-- ── Slack ───────────────────────────────────────────────────────────────
-- One-time codes for `/relay link <code>` (I4.3). Only the sha256 of the code is stored.
CREATE TABLE slack_link_tokens (
  token_hash   text PRIMARY KEY CONSTRAINT slack_link_tokens_hash_shape CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  user_id      uuid NOT NULL,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX slack_link_tokens_user_idx ON slack_link_tokens (workspace_id, user_id);
SELECT relay_enable_tenant_rls('slack_link_tokens', 'SELECT, INSERT, UPDATE');

-- Alerts sent to Slack (02 §4). `id` is the short opaque id carried (signed) in the button value.
CREATE TABLE slack_alerts (
  id            text PRIMARY KEY CONSTRAINT slack_alerts_id_shape CHECK (id ~ '^[A-Za-z0-9_-]{6,16}$'),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id),
  user_id       uuid NOT NULL,
  lead_id       uuid NOT NULL,
  lead_version  integer NOT NULL,
  slack_channel text,
  slack_ts      text,
  purpose       text NOT NULL,                           -- assigned | escalated | critical | fallback | ...
  status        text NOT NULL DEFAULT 'queued'
                CONSTRAINT slack_alerts_status_check
                CHECK (status IN ('queued', 'sent', 'failed', 'skipped', 'acknowledged', 'stale')),
  error         text,                                    -- localized-key-friendly reason code (visible in-app, I4.4)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX slack_alerts_lead_idx ON slack_alerts (workspace_id, lead_id, created_at DESC);
CREATE INDEX slack_alerts_failed_idx ON slack_alerts (workspace_id, created_at DESC) WHERE status IN ('failed', 'skipped');
CREATE TRIGGER slack_alerts_updated_at BEFORE UPDATE ON slack_alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('slack_alerts', 'SELECT, INSERT, UPDATE');

-- ── SECURITY DEFINER doors (06 §3): the ONLY cross-workspace lookups for this lane ──────
-- Owner-owned, pinned search_path, EXECUTE for app_user only, minimal columns.

-- Webhook routing: connection_key → connection (04 §2). The caller then verifies the signature with
-- the decrypted secrets; an unknown key is a 404 and never reveals anything.
CREATE FUNCTION integration_resolve_connection(p_provider text, p_connection_key text)
RETURNS TABLE (
  id uuid, workspace_id uuid, user_id uuid, status text, public_config jsonb, secrets_enc text,
  health jsonb, version integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT c.id, c.workspace_id, c.user_id, c.status, c.public_config, c.secrets_enc, c.health, c.version
    FROM public.integration_connections c
   WHERE c.provider = p_provider AND c.connection_key = p_connection_key
$$;
REVOKE ALL ON FUNCTION integration_resolve_connection(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integration_resolve_connection(text, text) TO app_user;

-- Idempotent inbox insert (04 §2 ingest()). Runs as the owner so a duplicate is found even when the
-- first copy has since been attributed to a workspace (RLS would hide it from a system tx). The
-- caller's own workspace context must match p_workspace_id, so this cannot write into another tenant.
-- Returns the row id and whether it is NEW (the caller enqueues processing only for new rows).
CREATE FUNCTION integration_event_ingest(
  p_workspace_id uuid,
  p_connection_id uuid,
  p_provider text,
  p_kind text,
  p_external_event_id text,
  p_payload_redacted jsonb,
  p_payload_hash text,
  p_normalized jsonb DEFAULT NULL
) RETURNS TABLE (id uuid, is_new boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  ctx uuid := nullif(current_setting('app.workspace_id', true), '')::uuid;
BEGIN
  IF p_workspace_id IS DISTINCT FROM ctx THEN
    RAISE EXCEPTION 'integration_event_ingest: workspace context mismatch' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_external_event_id IS NULL THEN
    RETURN QUERY
      INSERT INTO public.integration_events AS e
        (workspace_id, connection_id, provider, direction, kind, payload_redacted, payload_hash, normalized)
      VALUES (p_workspace_id, p_connection_id, p_provider, 'in', p_kind, p_payload_redacted, p_payload_hash, p_normalized)
      RETURNING e.id, true;
    RETURN;
  END IF;
  RETURN QUERY
    INSERT INTO public.integration_events AS e
      (workspace_id, connection_id, provider, direction, kind, external_event_id,
       payload_redacted, payload_hash, normalized)
    VALUES (p_workspace_id, p_connection_id, p_provider, 'in', p_kind, p_external_event_id,
            p_payload_redacted, p_payload_hash, p_normalized)
    ON CONFLICT (provider, external_event_id) WHERE direction = 'in' AND external_event_id IS NOT NULL
    DO UPDATE SET duplicate_count = e.duplicate_count + 1
    RETURNING e.id, (e.xmax = 0);
END
$$;
REVOKE ALL ON FUNCTION integration_event_ingest(uuid, uuid, text, text, text, jsonb, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integration_event_ingest(uuid, uuid, text, text, text, jsonb, text, jsonb) TO app_user;

-- Attribute a workspace-less inbound event (platform-default Slack app) once its payload resolved to a
-- workspace (alert id / link code). Only fills a NULL workspace; never moves an event between tenants.
CREATE FUNCTION integration_event_attribute(p_event_id uuid, p_workspace_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.integration_events SET workspace_id = p_workspace_id
   WHERE id = p_event_id AND workspace_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END
$$;
REVOKE ALL ON FUNCTION integration_event_attribute(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integration_event_attribute(uuid, uuid) TO app_user;

-- `/relay link <code>` arrives on the platform-default endpoint with no workspace: find the tenant that
-- minted the (valid, unused, unexpired) code. The caller then redeems it inside withWorkspaceTx.
CREATE FUNCTION slack_link_lookup(p_token_hash text)
RETURNS TABLE (workspace_id uuid, user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT t.workspace_id, t.user_id FROM public.slack_link_tokens t
   WHERE t.token_hash = p_token_hash AND t.used_at IS NULL AND t.expires_at > now()
$$;
REVOKE ALL ON FUNCTION slack_link_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION slack_link_lookup(text) TO app_user;

-- Button presses arrive without a workspace: the signed alert id identifies it.
CREATE FUNCTION slack_alert_lookup(p_alert_id text)
RETURNS TABLE (workspace_id uuid, user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT a.workspace_id, a.user_id FROM public.slack_alerts a WHERE a.id = p_alert_id
$$;
REVOKE ALL ON FUNCTION slack_alert_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION slack_alert_lookup(text) TO app_user;

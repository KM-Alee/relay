-- 202610181410_a_teams_leads.sql  (lane a) · T-120/T-122/T-123/T-124
-- teams, members, escalation policies, lead sources, web forms, leads, lead_events, notifications
-- (docs/02-data-model.md §2, §4; docs/03-lead-engine.md). [F3.1] [F3.2] [F3.3] [F3.4] [F3.5] [F3.8]
-- Runs once, in filename order, in ONE transaction, as the owner role. Never edit after merge.
--
-- contacts (Lane B, T-110) may not exist yet: leads.contact_id is a nullable uuid WITHOUT a FK, and the
-- lead carries a denormalised contact snapshot (name/phone/email). A follow-up migration adds the FK.

-- ── escalation policies (F3.5) ──────────────────────────────────────────
CREATE TABLE escalation_policies (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  name         text NOT NULL,
  repeat_count integer NOT NULL DEFAULT 1 CONSTRAINT escalation_policies_repeat_check CHECK (repeat_count BETWEEN 1 AND 10),
  version      integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT escalation_policies_ws_id_key UNIQUE (workspace_id, id)
);
CREATE TRIGGER escalation_policies_updated_at BEFORE UPDATE ON escalation_policies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('escalation_policies', 'SELECT, INSERT, UPDATE');

CREATE TABLE escalation_levels (
  id              uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspaces (id),
  policy_id       uuid NOT NULL,
  position        integer NOT NULL CONSTRAINT escalation_levels_position_check CHECK (position >= 1),
  target_type     text NOT NULL CONSTRAINT escalation_levels_target_check
                  CHECK (target_type IN ('next_eligible', 'user', 'team_backup', 'team_manager')),
  target_user_id  uuid,
  timeout_seconds integer NOT NULL CONSTRAINT escalation_levels_timeout_check CHECK (timeout_seconds > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT escalation_levels_policy_position_key UNIQUE (policy_id, position),
  CONSTRAINT escalation_levels_user_check CHECK (target_type <> 'user' OR target_user_id IS NOT NULL),
  FOREIGN KEY (workspace_id, policy_id) REFERENCES escalation_policies (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, target_user_id) REFERENCES users (workspace_id, id)
);
CREATE TRIGGER escalation_levels_updated_at BEFORE UPDATE ON escalation_levels FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('escalation_levels');

-- ── teams (F3.2, F3.3, F3.5) ────────────────────────────────────────────
CREATE TABLE teams (
  id                        uuid PRIMARY KEY,
  workspace_id              uuid NOT NULL REFERENCES workspaces (id),
  name                      text NOT NULL,
  is_default                boolean NOT NULL DEFAULT false,
  manager_user_id           uuid,
  backup_user_id            uuid,
  routing_mode              text NOT NULL DEFAULT 'round_robin'
                            CONSTRAINT teams_routing_mode_check CHECK (routing_mode IN ('round_robin', 'first_to_claim')),
  rr_cursor                 integer NOT NULL DEFAULT 0,
  default_capacity          integer NOT NULL DEFAULT 5 CONSTRAINT teams_capacity_check CHECK (default_capacity > 0),
  skills_routing            boolean NOT NULL DEFAULT false,
  ack_window_seconds        integer NOT NULL DEFAULT 120 CONSTRAINT teams_ack_check CHECK (ack_window_seconds > 0),
  urgent_ack_window_seconds integer NOT NULL DEFAULT 45 CONSTRAINT teams_urgent_check CHECK (urgent_ack_window_seconds > 0),
  routing_retry_seconds     integer NOT NULL DEFAULT 30 CONSTRAINT teams_retry_check CHECK (routing_retry_seconds > 0),
  idle_seconds              integer NOT NULL DEFAULT 600 CONSTRAINT teams_idle_check CHECK (idle_seconds > 0),
  idle_retrigger_enabled    boolean NOT NULL DEFAULT false,
  escalation_policy_id      uuid NOT NULL,
  version                   integer NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teams_ws_id_key UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, manager_user_id) REFERENCES users (workspace_id, id),
  FOREIGN KEY (workspace_id, backup_user_id) REFERENCES users (workspace_id, id),
  FOREIGN KEY (workspace_id, escalation_policy_id) REFERENCES escalation_policies (workspace_id, id)
);
CREATE UNIQUE INDEX teams_ws_default_key ON teams (workspace_id) WHERE is_default;
CREATE TRIGGER teams_updated_at BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('teams', 'SELECT, INSERT, UPDATE');

CREATE TABLE team_members (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  team_id      uuid NOT NULL,
  user_id      uuid NOT NULL,
  position     integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id),
  CONSTRAINT team_members_position_key UNIQUE (team_id, position) DEFERRABLE INITIALLY IMMEDIATE,
  FOREIGN KEY (workspace_id, team_id) REFERENCES teams (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_id) REFERENCES users (workspace_id, id)
);
CREATE INDEX team_members_user_idx ON team_members (workspace_id, user_id);
SELECT relay_enable_tenant_rls('team_members');

-- ── lead sources + public web forms (F3.1) ──────────────────────────────
CREATE TABLE lead_sources (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  key          text NOT NULL,
  label        text NOT NULL,
  kind         text NOT NULL CONSTRAINT lead_sources_kind_check CHECK (kind IN ('web_form', 'whatsapp', 'manual')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_sources_ws_key_key UNIQUE (workspace_id, key),
  CONSTRAINT lead_sources_ws_id_key UNIQUE (workspace_id, id)
);
SELECT relay_enable_tenant_rls('lead_sources');

CREATE TABLE web_forms (
  id                  uuid PRIMARY KEY,
  workspace_id        uuid NOT NULL REFERENCES workspaces (id),
  slug                text NOT NULL CONSTRAINT web_forms_slug_key UNIQUE
                      CONSTRAINT web_forms_slug_shape CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  title               text NOT NULL,
  team_id             uuid NOT NULL,
  pipeline_id         uuid,                            -- FK added with pipelines (T-111)
  field_ids           uuid[] NOT NULL DEFAULT '{}',
  is_active           boolean NOT NULL DEFAULT true,
  success_message_key text,
  version             integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT web_forms_ws_id_key UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, team_id) REFERENCES teams (workspace_id, id)
);
CREATE TRIGGER web_forms_updated_at BEFORE UPDATE ON web_forms FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('web_forms', 'SELECT, INSERT, UPDATE');

-- ── leads: the accountability core (02 §4, 03) ──────────────────────────
CREATE TABLE leads (
  id                     uuid PRIMARY KEY,
  workspace_id           uuid NOT NULL REFERENCES workspaces (id),
  contact_id             uuid,                         -- FK to contacts added after T-110
  opportunity_id         uuid,
  team_id                uuid NOT NULL,
  pipeline_id            uuid,
  contact_name           text NOT NULL,
  contact_phone          text,
  contact_email          citext,
  message                text,
  source_kind            text NOT NULL CONSTRAINT leads_source_kind_check CHECK (source_kind IN ('web_form', 'whatsapp', 'manual')),
  source_id              uuid,
  source_label           text NOT NULL,
  status                 text NOT NULL DEFAULT 'open' CONSTRAINT leads_status_check CHECK (status IN ('open', 'closed')),
  closed_reason          text CONSTRAINT leads_closed_reason_check CHECK (closed_reason IN ('won', 'lost', 'disqualified', 'merged')),
  owner_user_id          uuid NOT NULL,                -- NEVER NULL (03 §9.1)
  custody                text NOT NULL CONSTRAINT leads_custody_check CHECK (custody IN ('handler', 'fallback')),
  awaiting_handler       boolean NOT NULL DEFAULT false,
  awaiting_reason        text CONSTRAINT leads_awaiting_reason_check CHECK (awaiting_reason IN
                         ('no_available', 'all_at_capacity', 'no_skill_match', 'first_to_claim_pending',
                          'chain_exhausted', 'owner_absent', 'owner_deactivated')),
  ack_status             text NOT NULL DEFAULT 'pending' CONSTRAINT leads_ack_status_check CHECK (ack_status IN ('pending', 'acknowledged')),
  acknowledged_at        timestamptz,
  acknowledged_via       text,
  first_assigned_at      timestamptz NOT NULL,
  assigned_at            timestamptz NOT NULL,
  first_acknowledged_at  timestamptz,
  last_human_action_at   timestamptz,
  is_urgent              boolean NOT NULL DEFAULT false,
  urgent_source          text CONSTRAINT leads_urgent_source_check CHECK (urgent_source IN ('manual', 'ai')),
  is_critical            boolean NOT NULL DEFAULT false,
  escalation_level       integer NOT NULL DEFAULT 1,
  escalation_cycle       integer NOT NULL DEFAULT 0,
  escalation_count       integer NOT NULL DEFAULT 0,
  idle_retrigger_count   integer NOT NULL DEFAULT 0,
  overdue_attempt_count  integer NOT NULL DEFAULT 0,
  ack_window_ends_at     timestamptz,
  escalate_at            timestamptz,
  routing_retry_at       timestamptz,
  idle_check_at          timestamptz,
  base_window_ends_at    timestamptz NOT NULL,
  ai_active              boolean NOT NULL DEFAULT false,
  ai_started_at          timestamptz,
  ai_handoff_at          timestamptz,
  version                integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leads_ws_id_key UNIQUE (workspace_id, id),
  CONSTRAINT leads_custody_awaiting_check CHECK (custody = 'handler' OR awaiting_handler),
  CONSTRAINT leads_ack_check CHECK (ack_status = 'pending' OR acknowledged_at IS NOT NULL),
  CONSTRAINT leads_closed_check CHECK (status = 'open' OR closed_reason IS NOT NULL),
  FOREIGN KEY (workspace_id, owner_user_id) REFERENCES users (workspace_id, id),
  FOREIGN KEY (workspace_id, team_id) REFERENCES teams (workspace_id, id)
);
CREATE UNIQUE INDEX leads_open_contact_key ON leads (workspace_id, contact_id) WHERE status = 'open' AND contact_id IS NOT NULL;
CREATE INDEX leads_open_phone_idx ON leads (workspace_id, contact_phone) WHERE status = 'open';
CREATE INDEX leads_open_email_idx ON leads (workspace_id, contact_email) WHERE status = 'open';
CREATE INDEX leads_owner_open_idx ON leads (workspace_id, owner_user_id) WHERE status = 'open';
CREATE INDEX leads_ws_created_idx ON leads (workspace_id, created_at DESC);
CREATE INDEX leads_escalate_at_idx ON leads (escalate_at) WHERE status = 'open' AND escalate_at IS NOT NULL;
CREATE INDEX leads_routing_retry_at_idx ON leads (routing_retry_at) WHERE status = 'open' AND routing_retry_at IS NOT NULL;
CREATE INDEX leads_idle_check_at_idx ON leads (idle_check_at) WHERE status = 'open' AND idle_check_at IS NOT NULL;
CREATE TRIGGER leads_updated_at BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('leads', 'SELECT, INSERT, UPDATE');

-- Append-only lead timeline and metrics source (02 §4). No UPDATE/DELETE for app_user.
CREATE TABLE lead_events (
  id               uuid PRIMARY KEY,
  workspace_id     uuid NOT NULL REFERENCES workspaces (id),
  lead_id          uuid NOT NULL,
  type             text NOT NULL CONSTRAINT lead_events_type_check CHECK (type IN (
                     'intake_assigned', 'routing_retry_assigned', 'escalation', 'overdue_attempt',
                     'absence_reassign', 'deactivation_reassign', 'manual_reassign', 'claim', 'pond_claim',
                     'claim_rejected', 'idle_retrigger', 'acknowledged', 'critical_flagged',
                     'critical_cleared', 'urgent_set', 'ai_started', 'ai_handoff', 'closed')),
  from_user_id     uuid,
  to_user_id       uuid,
  custody          text CONSTRAINT lead_events_custody_check CHECK (custody IN ('handler', 'fallback')),
  escalation_level integer,
  trace            jsonb,
  meta             jsonb,
  actor_type       text NOT NULL CONSTRAINT lead_events_actor_check CHECK (actor_type IN ('user', 'system', 'ai')),
  actor_user_id    uuid,
  occurred_at      timestamptz NOT NULL,
  FOREIGN KEY (workspace_id, lead_id) REFERENCES leads (workspace_id, id)
);
CREATE INDEX lead_events_lead_idx ON lead_events (workspace_id, lead_id, occurred_at);
CREATE INDEX lead_events_type_time_idx ON lead_events (workspace_id, type, occurred_at);
SELECT relay_enable_tenant_rls('lead_events', 'SELECT, INSERT');

-- ── in-app notifications (F3.4) ─────────────────────────────────────────
CREATE TABLE notifications (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  user_id      uuid NOT NULL,
  type         text NOT NULL,
  lead_id      uuid,
  params       jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, user_id) REFERENCES users (workspace_id, id),
  FOREIGN KEY (workspace_id, lead_id) REFERENCES leads (workspace_id, id)
);
CREATE INDEX notifications_user_idx ON notifications (workspace_id, user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (workspace_id, user_id) WHERE read_at IS NULL;
SELECT relay_enable_tenant_rls('notifications', 'SELECT, INSERT, UPDATE');

-- ── SECURITY DEFINER doors (06 §3): cross-workspace, ids only ────────────

-- Due lead timers (03 §6). Returns candidates only: each one is re-locked and re-checked in its own
-- withWorkspaceTx (FOR UPDATE + guard + version), so two racing ticks escalate once (F3.8).
CREATE FUNCTION relay_lead_timers_claim(p_limit integer, p_workspace_ids uuid[] DEFAULT NULL)
RETURNS TABLE (id uuid, workspace_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT l.id, l.workspace_id FROM public.leads l
   WHERE l.status = 'open'
     AND (l.escalate_at <= now() OR l.routing_retry_at <= now() OR l.idle_check_at <= now())
     AND (p_workspace_ids IS NULL OR l.workspace_id = ANY (p_workspace_ids))
   ORDER BY LEAST(l.escalate_at, l.routing_retry_at, l.idle_check_at), l.id
   LIMIT greatest(p_limit, 0)
   FOR UPDATE SKIP LOCKED
$$;

CREATE FUNCTION relay_lead_timers_next_due(p_workspace_ids uuid[] DEFAULT NULL)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT min(LEAST(l.escalate_at, l.routing_retry_at, l.idle_check_at)) FROM public.leads l
   WHERE l.status = 'open'
     AND (l.escalate_at IS NOT NULL OR l.routing_retry_at IS NOT NULL OR l.idle_check_at IS NOT NULL)
     AND (p_workspace_ids IS NULL OR l.workspace_id = ANY (p_workspace_ids))
$$;

-- Public form (/f/:slug, no session): slug → workspace + form, nothing else.
CREATE FUNCTION relay_web_form_lookup(p_slug text)
RETURNS TABLE (form_id uuid, workspace_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT f.id, f.workspace_id FROM public.web_forms f WHERE f.slug = p_slug AND f.is_active
$$;

REVOKE ALL ON FUNCTION relay_lead_timers_claim(integer, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION relay_lead_timers_next_due(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION relay_web_form_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION relay_lead_timers_claim(integer, uuid[]) TO app_user;
GRANT EXECUTE ON FUNCTION relay_lead_timers_next_due(uuid[]) TO app_user;
GRANT EXECUTE ON FUNCTION relay_web_form_lookup(text) TO app_user;

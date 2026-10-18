-- 202610181400_c_payments_calendar.sql  (lane c) · T-143/T-144 · Stripe payments + Google Calendar tables
-- (docs/02-data-model.md payments/appointments/oauth_states; docs/04-integrations.md §4/§5). [I2.1] [I2.4] [I2.5] [I2.6] [I2.7] [I3.1] [I3.3] [I3.5] [I3.6]
-- Runs once, in filename order, as the owner role. Never edit after merge.
--
-- Deliberately NO foreign keys to opportunities / contacts / users / conversations / leads: those tables belong
-- to other lanes (B2 opportunities+contacts land later). Columns are plain uuids; a follow-up migration adds the
-- composite FKs once everything is merged. Everything here references only `workspaces`.

-- ── payment_requests (I2.1, I2.5, I2.7) ─────────────────────────────────
-- amount_minor/currency = what Stripe charges (the test account is US: USD). display_text keeps the ORIGINAL
-- value ("PKR 50,000") so the UI/WhatsApp copy shows what the customer agreed, even when Stripe bills USD.
CREATE TABLE payment_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES workspaces (id),
  opportunity_id     uuid NOT NULL,
  contact_id         uuid,
  conversation_id    uuid,
  requested_by       uuid,
  amount_minor       bigint NOT NULL CONSTRAINT payment_requests_amount_pos CHECK (amount_minor > 0),
  currency           text NOT NULL CONSTRAINT payment_requests_currency_shape CHECK (currency ~ '^[A-Z]{3}$'),
  display_text       text,
  description        text,
  provider           text NOT NULL DEFAULT 'stripe',
  provider_ref       text,                              -- Checkout Session id (cs_test_…)
  payment_intent_ref text,                              -- pi_… (set on completion/failure; links refunds)
  url                text,
  status             text NOT NULL DEFAULT 'pending'
                     CONSTRAINT payment_requests_status_check
                     CHECK (status IN ('pending', 'paid', 'expired', 'failed', 'refunded', 'partially_refunded')),
  failure_reason     text,
  paid_at            timestamptz,
  expires_at         timestamptz,
  version            integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_requests_ws_id_key UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX payment_requests_provider_ref_key ON payment_requests (provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX payment_requests_pi_idx ON payment_requests (payment_intent_ref) WHERE payment_intent_ref IS NOT NULL;
CREATE INDEX payment_requests_opp_idx ON payment_requests (workspace_id, opportunity_id, created_at DESC);
CREATE INDEX payment_requests_ws_idx ON payment_requests (workspace_id, created_at DESC);
CREATE TRIGGER payment_requests_updated_at BEFORE UPDATE ON payment_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('payment_requests', 'SELECT, INSERT, UPDATE');

-- ── payments: the money ledger. Collected revenue = Σ charge − Σ refund (I2.6) ─────────
CREATE TABLE payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES workspaces (id),
  payment_request_id uuid NOT NULL,
  kind               text NOT NULL CONSTRAINT payments_kind_check CHECK (kind IN ('charge', 'refund')),
  amount_minor       bigint NOT NULL CONSTRAINT payments_amount_pos CHECK (amount_minor > 0),
  currency           text NOT NULL,
  provider_ref       text NOT NULL,                      -- payment_intent id (charge) / refund id (refund)
  provider_event_id  text,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- A replayed *different* event can never double-record (I2.4).
  CONSTRAINT payments_provider_ref_kind_key UNIQUE (provider_ref, kind)
);
CREATE INDEX payments_request_idx ON payments (workspace_id, payment_request_id);
CREATE INDEX payments_ws_time_idx ON payments (workspace_id, occurred_at DESC);
SELECT relay_enable_tenant_rls('payments', 'SELECT, INSERT');

-- Stripe webhooks on the platform-default endpoint arrive without a workspace: the signed event's metadata
-- (payment_request_id) or payment intent id identifies the tenant. Minimal columns, definer-only door.
CREATE FUNCTION payment_resolve_workspace(p_request_id uuid, p_provider_ref text, p_payment_intent text)
RETURNS TABLE (workspace_id uuid, payment_request_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT r.workspace_id, r.id FROM public.payment_requests r
   WHERE (p_request_id IS NOT NULL AND r.id = p_request_id)
      OR (p_provider_ref IS NOT NULL AND r.provider_ref = p_provider_ref)
      OR (p_payment_intent IS NOT NULL AND r.payment_intent_ref = p_payment_intent)
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION payment_resolve_workspace(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payment_resolve_workspace(uuid, text, text) TO app_user;

-- ── oauth_states: Google OAuth state + PKCE (I3.1). Single use, 10 minutes ──────────────
CREATE TABLE oauth_states (
  state_hash        text PRIMARY KEY CONSTRAINT oauth_states_hash_shape CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  workspace_id      uuid NOT NULL REFERENCES workspaces (id),
  user_id           uuid NOT NULL,
  provider          text NOT NULL DEFAULT 'google_calendar',
  code_verifier_enc text NOT NULL,                       -- AES-256-GCM envelope (core/secrets.ts)
  return_to         text,
  expires_at        timestamptz NOT NULL,
  used_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_states_user_idx ON oauth_states (workspace_id, user_id);
SELECT relay_enable_tenant_rls('oauth_states', 'SELECT, INSERT, UPDATE');

-- ── appointments (I3.3, I3.5, I3.6): UTC + IANA zone ────────────────────────────────────
CREATE TABLE appointments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces (id),
  contact_id        uuid,
  opportunity_id    uuid,
  lead_id           uuid,
  user_id           uuid NOT NULL,                       -- whose calendar
  connection_id     uuid,
  provider_event_id text,
  html_link         text,
  title             text NOT NULL,
  notes             text,
  attendee_email    text,
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  timezone          text NOT NULL,                       -- IANA, e.g. Asia/Karachi
  status            text NOT NULL DEFAULT 'scheduled'
                    CONSTRAINT appointments_status_check CHECK (status IN ('scheduled', 'cancelled')),
  sync_status       text NOT NULL DEFAULT 'pending'
                    CONSTRAINT appointments_sync_check CHECK (sync_status IN ('pending', 'synced', 'failed')),
  sync_error        text,
  created_by        uuid,
  version           integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointments_time_order CHECK (ends_at > starts_at),
  CONSTRAINT appointments_ws_id_key UNIQUE (workspace_id, id)
);
CREATE INDEX appointments_user_time_idx ON appointments (workspace_id, user_id, starts_at) WHERE status = 'scheduled';
CREATE INDEX appointments_ws_time_idx ON appointments (workspace_id, starts_at);
CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('appointments', 'SELECT, INSERT, UPDATE');

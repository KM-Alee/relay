-- 202610181431_c_ai_knowledge.sql (lane c2b) T-208 [F6.5] [F6.1]
-- Per-workspace knowledge base for the AI stand-in + one AI settings row per workspace.
CREATE TABLE ai_knowledge (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  kind         text NOT NULL DEFAULT 'faq' CONSTRAINT ai_knowledge_kind_check CHECK (kind IN ('pricing', 'service', 'faq', 'hours', 'area')),
  title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body         text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  language     text NOT NULL DEFAULT 'en' CONSTRAINT ai_knowledge_language_check CHECK (language IN ('en', 'ur', 'ur-Latn')),
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_knowledge_ws_idx ON ai_knowledge (workspace_id, enabled);
CREATE TRIGGER ai_knowledge_updated_at BEFORE UPDATE ON ai_knowledge
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('ai_knowledge');

CREATE TABLE ai_settings (
  workspace_id            uuid PRIMARY KEY REFERENCES workspaces (id),
  -- off | unacked (after N seconds unacked) | no_handler (nobody available) | after_hours
  standin_mode            text NOT NULL DEFAULT 'off' CONSTRAINT ai_settings_mode_check CHECK (standin_mode IN ('off', 'unacked', 'no_handler', 'after_hours')),
  trigger_unacked_seconds integer NOT NULL DEFAULT 60 CHECK (trigger_unacked_seconds BETWEEN 10 AND 3600),
  daily_cost_cap_micros   bigint NOT NULL DEFAULT 2000000 CHECK (daily_cost_cap_micros >= 0),
  triage_enabled          boolean NOT NULL DEFAULT true,
  transcribe_enabled      boolean NOT NULL DEFAULT true,
  ai_enabled              boolean NOT NULL DEFAULT true,  -- per-workspace flag (the global AI_ENABLED still wins)
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER ai_settings_updated_at BEFORE UPDATE ON ai_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT relay_enable_tenant_rls('ai_settings');

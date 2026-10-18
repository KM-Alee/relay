-- 202610181302_c2_ai_usage.sql (lane c2) T-204 [I6.4] [I6.5]
-- One row per AI call (tokens, cost estimate in micro-USD). The daily cap sums today's rows.
-- Append-only for the app (no UPDATE/DELETE).
CREATE TABLE ai_usage (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id),
  task           text NOT NULL,
  model          text NOT NULL,
  prompt_version text,
  status         text NOT NULL,
  in_tokens      integer NOT NULL DEFAULT 0,
  out_tokens     integer NOT NULL DEFAULT 0,
  cost_micros    bigint NOT NULL DEFAULT 0,
  latency_ms     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ai_usage_workspace_day_idx ON ai_usage (workspace_id, created_at);

SELECT relay_enable_tenant_rls('ai_usage', 'SELECT, INSERT');

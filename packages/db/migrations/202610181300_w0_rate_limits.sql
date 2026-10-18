-- W0 · T-006 · fixed-window rate limits (docs/02-data-model.md §1, docs/06-security.md §1). [Q1] [Q3]
-- Global table (no workspace_id, no RLS). One upsert per hit; works through the Neon pooler.
CREATE TABLE rate_limits (
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
-- Pruning (daily job: windows older than 1 day).
CREATE INDEX rate_limits_window_start_idx ON rate_limits (window_start);

GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limits TO app_user;

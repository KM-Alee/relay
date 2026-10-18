-- 202610181500_a_lead_ai_brief.sql  (lane a) · T-206/T-207 glue
-- Latest AI handoff brief for the lead (F6.10, F9.2): shown on the lead page at takeover and attached
-- to Slack escalation alerts when already available (alerts never wait for AI). Display data only:
-- never an engine column (no ownership, acknowledgement or timer meaning).
ALTER TABLE leads ADD COLUMN ai_brief jsonb;
ALTER TABLE leads ADD COLUMN ai_brief_at timestamptz;

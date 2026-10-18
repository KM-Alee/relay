-- Atomic claim for multi-transaction event processors (Slack): `processing` is a short lease
-- (processed_at holds the claim time; a crashed claimer is retaken after 2 min). [I5.1] [I5.2] [I4.5]
ALTER TABLE integration_events DROP CONSTRAINT integration_events_status_check;
ALTER TABLE integration_events ADD CONSTRAINT integration_events_status_check
  CHECK (status IN ('received', 'processing', 'processed', 'rejected', 'failed', 'ignored'));

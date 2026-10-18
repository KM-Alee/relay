// Shared file: ONE export line per domain schema file (docs/13-parallel-development.md §3).
// Never put another domain's table in your file. Owners: 13 §2.
export * from './workspaces'; // W0
export * from './rate-limits'; // W0
export * from './identity'; // B: users, sessions, roles, invites, permissions
export * from './crm'; // B: contacts, companies, opportunities, pipelines, fields, tags, lists, activities
export * from './audit'; // B: audit_events
export * from './leads'; // A: leads, lead_events, routing, escalation policies
export * from './jobs'; // A: outbox, scheduler_state, job_runs
export * from './teams'; // A: teams, members, availability
export * from './notifications'; // A: in-app notifications
export * from './integrations'; // C: integration_connections, integration_events
export * from './messaging'; // C: conversations, messages, templates
export * from './payments'; // C: payment_requests
export * from './calendar'; // C: appointments, oauth_states
export * from './ai'; // C: ai_usage, knowledge
export * from './realtime'; // C: realtime_events

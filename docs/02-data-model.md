# 02 — Data Model

> **Status:** Accepted baseline schema. Exact Drizzle definitions live in `packages/db/src/schema/*`. **If you change a table, update this doc in the same PR.**
> Conventions: `snake_case` in SQL, `camelCase` in TS. All IDs are `uuid` (v7, generated in app) unless noted. All timestamps are `timestamptz` (UTC). Money is `bigint` minor units + `char(3)` currency.

## 0. Global rules

1. **Every workspace-scoped table has `workspace_id uuid NOT NULL`**, RLS enabled **and forced**, and the policy `workspace_id = current_setting('app.workspace_id')::uuid` (see `06-security.md` §3).
2. **Composite foreign keys for tenant safety.** Parent tables expose `UNIQUE (workspace_id, id)`. Children reference `(workspace_id, parent_id)`. A row can therefore never point at another workspace's row, even when someone guesses an ID (F1.6).
3. **Optimistic locking.** Mutable aggregates (`leads`, `contacts`, `companies`, `opportunities`, `stages`, `pipelines`, `custom_fields`, `teams`, `users`, `workspaces`, `integration_connections`, `appointments`, `payment_requests`) have `version int NOT NULL DEFAULT 0`. Updates use `WHERE id = $1 AND version = $2` and `SET version = version + 1`. Zero rows updated means `409 CONFLICT` with code `STALE_VERSION` (Q4).
4. **Soft delete only for CRM records** (`contacts`, `companies`, `opportunities`: `deleted_at`). Users are **deactivated**, never deleted (F1.8). Configuration (stages, fields, tags) is hard-deleted through the safe flows below. Audit rows are never deleted.
5. `created_at`, `updated_at` on everything. `updated_at` is maintained by a trigger.
6. Enums are Postgres enums where the value set is fixed, and `text` + check where a workspace configures the values.
7. Migrations are hand-written SQL in `packages/db/migrations/<YYYYMMDDHHmm>_<lane>_<slug>.sql`, applied in filename order by `packages/db/src/migrate.ts` and recorded (with a sha256 checksum) in the runner-internal table `schema_migrations(filename, checksum, applied_at)`. Helpers available to every migration: `set_updated_at()` (trigger fn) and `relay_enable_tenant_rls(table, privs)` (template: `packages/db/sql/templates/tenant-table.sql`).

## 1. Tenancy, identity, access

| Table | Key columns | Notes |
|---|---|---|
| `workspaces` | `id, name, slug UNIQUE, owner_user_id, default_locale ('en'|'ur'), timezone (IANA), currency, default_lead_value_minor, time_warp_multiplier numeric(6,2) DEFAULT 1 CHECK > 0, demo_mode bool, business_hours jsonb, settings jsonb (e.g. invite_ttl_hours), version` | Not RLS-filtered by `workspace_id`. The policy is `id = current_setting(...)` |
| `users` | `id, workspace_id, email citext UNIQUE (global), name, password_hash, base_level ('owner'|'admin'|'user'), availability ('available'|'busy'|'on_leave'|'offline'), is_active bool, deactivated_at, locale, timezone, capacity int NULL (P1 per-employee; NULL = team default), skills text[], slack_user_id text NULL, slack_team_id text NULL, ui_prefs jsonb (dashboard figures F5.5, theme, sound, radar layout), version` | **One user belongs to exactly one workspace** (ADR-0004). Email is globally unique, so login needs no workspace picker |
| `level_permissions` | `workspace_id, base_level, permissions text[]` | Default grants per base level, editable by the Owner |
| `roles` | `id, workspace_id, name, permissions text[], is_system bool` | Custom roles (F1.7). Seeded "Manager" (`is_system=false`, editable) |
| `user_roles` | `workspace_id, user_id, role_id` PK(user_id, role_id) | |
| `user_permission_overrides` | `workspace_id, user_id, permission, effect ('grant'|'deny')` | Lets the Owner grant or remove a single permission (F1.3) |
| `sessions` | `id, user_id, workspace_id, token_hash bytea UNIQUE, created_at, last_seen_at, expires_at, revoked_at, ip inet, user_agent` | Cookie holds a random token. The DB stores only its SHA-256 |
| `invites` | `id, workspace_id, token_hash UNIQUE, base_level, role_id NULL, created_by, expires_at, used_at, used_by, revoked_at` | Single-use (F1.2) |
| `rate_limits` | `key text, window_start timestamptz, count int` PK(key, window_start) | Global (no RLS). Login, public form, nudge |

**As built (T-101/T-102, `202610181302_b_identity.sql`):** `users` (enums `user_base_level`, `user_availability` default `available`; CHECK inactive ⇒ `deactivated_at`; RLS SELECT/INSERT/UPDATE, no DELETE), `level_permissions` PK `(workspace_id, base_level)` (rows for `admin`/`user`; a missing row falls back to the code defaults in `contracts/permission-defaults.ts`), `roles` (+ `key` for seeded roles, e.g. `'manager'`; unique `(workspace_id, lower(name))`), `user_roles`, `user_permission_overrides` (`effect` CHECK), `sessions` (+ `rotate_required bool`: set on privilege change, the next API request swaps the token; `token_hash` CHECK 32 bytes). Composite FKs `(workspace_id, user_id)` everywhere; `workspaces (id, owner_user_id)` → `users (workspace_id, id)`; `audit_events (workspace_id, actor_user_id)` → users. SECURITY DEFINER: `auth_find_user_by_email(citext)`, `auth_resolve_session(bytea)` (returns also `last_seen_at`, `rotate_required`). `invites` comes with T-103.

**Effective permissions** = `level_permissions[base_level]` ∪ permissions of all assigned roles, then apply overrides (`deny` wins over `grant`). `owner` always has everything. The permission catalogue is in `06-security.md` §2.

## 2. Teams and routing configuration

| Table | Key columns | Notes |
|---|---|---|
| `teams` | `id, workspace_id, name, manager_user_id, backup_user_id, routing_mode ('round_robin'|'first_to_claim'), rr_cursor int DEFAULT 0, default_capacity int, skills_routing bool, ack_window_seconds int, urgent_ack_window_seconds int, routing_retry_seconds int, idle_seconds int, idle_retrigger_enabled bool DEFAULT false (P1 F3.10), escalation_policy_id, version` | "Team or pipeline" backup + manager (F3.5). Every workspace has ≥ 1 team |
| `team_members` | `workspace_id, team_id, user_id, position int` | Ordering for round-robin |
| `escalation_policies` | `id, workspace_id, name, repeat_count int DEFAULT 1, version` | |
| `escalation_levels` | `id, workspace_id, policy_id, position, target_type ('next_eligible'|'user'|'team_backup'|'team_manager'), target_user_id NULL, timeout_seconds int` | Default policy: next_eligible → next_eligible → team_backup → team_manager |
| `lead_sources` | `id, workspace_id, key, label, kind ('web_form'|'whatsapp'|'manual')` | Manual-entry source list (F3.1) |
| `web_forms` | `id, workspace_id, slug UNIQUE, pipeline_id, team_id, field_ids uuid[], is_active, success_message_key` | Public form + embed (F3.1) |

## 3. CRM

| Table | Key columns | Notes |
|---|---|---|
| `companies` | `id, workspace_id, name, owner_user_id, deleted_at, version` | |
| `contacts` | `id, workspace_id, company_id NULL, name, phone_e164, email citext, owner_user_id NULL, language ('en'|'ur'|'ur-Latn') NULL, language_source ('detected'|'manual'), opted_out bool, opted_out_at, ai_profile jsonb, last_activity_at, deleted_at, version` | Partial unique on `(workspace_id, phone_e164)` and `(workspace_id, email)` where not deleted (I1.5, F2.12) |
| `pipelines` | `id, workspace_id, name, team_id, position, is_default` | |
| `stages` | `id, workspace_id, pipeline_id, name, position, kind ('open'|'won'|'lost'), rot_seconds NULL (P1 F2.9), version` | Unique `(pipeline_id, position)` deferrable, for reordering |
| `stage_required_fields` | `workspace_id, stage_id, field_id` | F2.4. Cascades when the field is deleted |
| `opportunities` | `id, workspace_id, contact_id, pipeline_id, stage_id, title, value_minor bigint NULL, currency, owner_user_id, stage_entered_at, last_activity_at, closed_at, deleted_at, version` | Value is masked by permission (F1.4) |
| `custom_fields` | `id, workspace_id, entity ('contact'|'company'|'opportunity'), pipeline_id NULL, key, label jsonb {en,ur}, type ('text'|'number'|'date'|'dropdown'|'checkbox'|'ai'), options jsonb, ai_config jsonb NULL {output_type, prompt, prompt_version}, position, version` | `pipeline_id` NULL = shared. Set means pipeline-specific (F2.3) |
| `field_values` | `id, workspace_id, field_id, contact_id NULL, company_id NULL, opportunity_id NULL, value jsonb, source ('human'|'ai'|'import'), updated_by NULL, updated_at` | Exactly one entity FK (CHECK). `ON DELETE CASCADE` from `custom_fields`, so no orphans (Q4). An AI write may replace an `ai` value but **never a `human` one** (F6.4, F9.1) |
| `tags` | `id, workspace_id, name` UNIQUE(workspace_id, lower(name)) | |
| `contact_tags`, `opportunity_tags` | `workspace_id, tag_id, contact_id / opportunity_id` | `ON DELETE CASCADE` from tags (F2.1) |
| `saved_lists` | `id, workspace_id, owner_user_id, name, entity, criteria jsonb, is_shared` | Criteria are evaluated at query time, so lists are always live (F2.6) |
| `activities` | `id, workspace_id, contact_id NULL, opportunity_id NULL, lead_id NULL, type, actor_type ('user'|'system'|'ai'), actor_user_id NULL, payload jsonb, occurred_at` | The timeline (F2.7). Types: `note, call, stage_change, assignment, field_edit, message_in, message_out, ai_message, payment, appointment, import, system` |

**Safe deletes**
- Stage with opportunities: `DELETE /stages/:id { moveToStageId }` moves them, writes `stage_change` activities and the audit event, then deletes the stage, all in one tx (F2.5).
- Custom field: cascades `field_values` and `stage_required_fields`. Saved-list criteria that referenced it are rewritten to drop that clause and flagged `needs_review`.
- Tag: cascades the join rows (F2.1).

## 4. Leads: the accountability core (see `03-lead-engine.md`)

`leads`

| Column | Type | Meaning |
|---|---|---|
| `id, workspace_id, contact_id, opportunity_id NULL, team_id, pipeline_id` | | |
| `source_kind, source_id, source_label` | | `web_form` / `whatsapp` / `manual` + label (F3.1) |
| `status` | `'open'|'closed'` | Closed = won/lost/disqualified/merged (`closed_reason`) |
| `owner_user_id` | `uuid NOT NULL` | **The one accountable human. Never null.** |
| `custody` | `'handler'|'fallback'` | `fallback` = the manager/Owner holds custody (F3 header) |
| `awaiting_handler` | `bool` | True whenever `custody='fallback'` because no eligible handler accepted |
| `awaiting_reason` | `text NULL` | Code: `no_available`, `all_at_capacity`, `no_skill_match`, `first_to_claim_pending`, `chain_exhausted`, `owner_absent`, `owner_deactivated` |
| `ack_status` | `'pending'|'acknowledged'` | Human-only (Section 9) |
| `acknowledged_at, acknowledged_via` | | `via`: `app`, `slack`, `action:<type>`, `claim`, `pond_claim` |
| `first_assigned_at` | `NOT NULL` | Set at intake (includes fallback custody). **Never reset** |
| `assigned_at` | `NOT NULL` | Last ownership change |
| `first_acknowledged_at` | `NULL` | **Never reset** after first set |
| `last_human_action_at` | `NULL` | Any recorded human action by the owner |
| `is_urgent, urgent_source ('manual'|'ai')` | | F3.12 |
| `is_critical` | `bool` | Chain exhausted (F3.5) |
| `escalation_level, escalation_cycle` | `int` | Position in the policy |
| `escalation_count` | `int` | **Ack-timeout reassignments only** (original metric) |
| `idle_retrigger_count` | `int` | P1 F3.10, separate counter |
| `overdue_attempt_count` | `int` | Expired windows with no transfer |
| `ack_window_ends_at` | `NULL` | Current acknowledgement window end (countdown) |
| `escalate_at` | `NULL` | **Timer**: next escalation evaluation (= `ack_window_ends_at` while pending) |
| `routing_retry_at` | `NULL` | **Timer**: retry eligibility while `awaiting_handler` |
| `idle_check_at` | `NULL` | **Timer**: P1 idle re-trigger / idle recovery flag |
| `base_window_ends_at` | `NOT NULL` | `first_assigned_at + base ack window`. Used by recovery criterion (a) |
| `ai_active, ai_started_at, ai_handoff_at` | | F6 state mirror (conversation holds detail) |
| `version` | `int` | F3.8 |

Constraints and indexes:
- `UNIQUE (workspace_id, contact_id) WHERE status = 'open'`: at most one open lead per contact. A new inbound message attaches to it.
- `CHECK (custody = 'handler' OR awaiting_handler)`, `CHECK (ack_status = 'pending' OR acknowledged_at IS NOT NULL)`.
- Partial indexes for the timer loop: `(escalate_at) WHERE status='open' AND escalate_at IS NOT NULL`, and likewise for `routing_retry_at` and `idle_check_at`.

`lead_events` (append-only lead timeline; the metrics source)

| Column | Notes |
|---|---|
| `id, workspace_id, lead_id, type, from_user_id, to_user_id, custody, escalation_level, trace jsonb, actor_type, actor_user_id, occurred_at` | |
| `type` ∈ | `intake_assigned`, `routing_retry_assigned`, `escalation`, `overdue_attempt`, `absence_reassign`, `deactivation_reassign`, `manual_reassign`, `claim`, `pond_claim`, `claim_rejected`, `idle_retrigger`, `acknowledged`, `critical_flagged`, `critical_cleared`, `urgent_set`, `ai_started`, `ai_handoff`, `closed` |
| `trace` | Routing decision trace (F3.11): `[{userId, name, outcome:'skipped'|'chosen', reason:'on_leave'|'at_capacity'|'inactive'|'no_skill'|'busy'|'offline'|'already_tried'|'round_robin_next'|...}]` |

`notifications`: `id, workspace_id, user_id, type, lead_id NULL, params jsonb, read_at, created_at` (in-app centre with unread count, F3.4).

`slack_alerts`: `id (short random text, ≤ 16 chars), workspace_id, user_id, lead_id, lead_version, slack_channel, slack_ts, purpose, status, created_at`. The Block Kit button `value` is the signed opaque alert id (`lead_ack`). On press, compare the stored `lead_version`/owner against the current lead (I4.5). `slack_channel` + `slack_ts` allow `chat.update`.

## 5. Messaging

| Table | Key columns | Notes |
|---|---|---|
| `conversations` | `id, workspace_id, contact_id, channel ('whatsapp'), connection_id, external_key (customer wa_id), assigned_user_id, last_inbound_at, ai_state ('off'|'active'|'handed_off'), ai_mode_override NULL, ai_started_at, ai_handoff_at, ai_brief jsonb NULL (handoff card F6.10/F9.2), ai_draft jsonb NULL (Suggest mode), ai_questions_state jsonb (F6.4 progress), language, version` | Window open ⇔ `now() < last_inbound_at + 24h` (I1.10). `assigned_user_id` follows the lead owner |
| `messages` | `id, workspace_id, conversation_id, direction ('in'|'out'), author_type ('customer'|'user'|'ai'|'system'), author_user_id NULL, kind ('text'|'template'|'audio'|'image'|'document'|'event'), body, template_key NULL, media_id NULL, provider_message_id NULL, status ('queued'|'sending'|'sent'|'delivered'|'read'|'failed'), status_reason, status_at, transcript, transcript_status ('none'|'pending'|'done'|'failed'), summary, prompt_version NULL, ai_meta jsonb, client_key NULL, created_at` | `UNIQUE (connection_id, provider_message_id)` → duplicates are impossible (I1.8). Status only moves forward (`sent<delivered<read`); `failed` is terminal unless retried. `kind='event'` covers in-thread events such as "Paid ✓" (I2.2) and "Hamza joined" |
| `media` | `id, workspace_id, blob_key, mime, size_bytes, sha256, provider_media_id, created_at` | Stored in Vercel Blob. Served by `/api/media/:id` after a permission check |
| `message_templates` | `id, workspace_id, key, locale ('en'|'ur'|'ur-Latn'), body, wa_template_name NULL, wa_template_lang NULL` | Keys: `ai_disclosure`, `ai_fallback_reply`, `ai_holding`, `human_joined`, `payment_link`, `booking_confirmation`, `form_ack`, … (F7.6) |

## 6. Payments (Stripe)

| Table | Key columns | Notes |
|---|---|---|
| `payment_requests` | `id, workspace_id, opportunity_id, contact_id, conversation_id NULL, requested_by, amount_minor, currency, provider ('stripe'), provider_ref (checkout session id), url, status ('open'|'paid'|'expired'|'failed'|'refunded'|'partially_refunded'), paid_at, expires_at, version` | I2.1, I2.5, I2.7 |
| `payments` | `id, workspace_id, payment_request_id, kind ('charge'|'refund'), amount_minor, currency, provider_ref (payment_intent / refund id), occurred_at, provider_event_id` | `UNIQUE (provider_ref, kind)` plus event idempotency. **Collected revenue = Σ charge − Σ refund** (Section 9) |

No card data columns exist anywhere (I2.8).

## 7. Calendar

| Table | Key columns | Notes |
|---|---|---|
| `appointments` | `id, workspace_id, contact_id, opportunity_id NULL, lead_id NULL, user_id, connection_id, provider_event_id, starts_at, ends_at, timezone (IANA), title, status ('scheduled'|'cancelled'), created_by, version` | UTC + IANA zone (I3.5) |

The calendar connection is an `integration_connections` row with `user_id` set (per employee, I3.1).

## 8. Integrations and jobs

| Table | Key columns | Notes |
|---|---|---|
| `integration_connections` | `id, workspace_id, user_id NULL, provider ('meta_whatsapp'|'twilio_whatsapp'|'stripe'|'google_calendar'|'slack'|'openai'), status ('not_connected'|'connected'|'error'|'needs_reconnect'), connection_key text UNIQUE (webhook path token), public_config jsonb, secrets_enc bytea, secrets_hint text (last 4), last_ok_at, last_error_at, last_error, health jsonb (breaker), version` | I5.1–I5.3, I5.7 |
| `integration_events` | `id, workspace_id NULL, connection_id NULL, provider, direction ('in'|'out'), kind, external_event_id NULL, status ('received'|'processed'|'rejected'|'failed'|'ignored'), duplicate_count int, http_status, latency_ms, reference, payload_redacted jsonb, normalized jsonb NULL (parsed event, for replay I5.9), error, ai_tokens_in, ai_tokens_out, ai_cost_micros, prompt_version, replay_of NULL, created_at, processed_at` | `UNIQUE (provider, external_event_id) WHERE direction='in'`. A duplicate does `ON CONFLICT DO UPDATE SET duplicate_count = duplicate_count + 1`. Rejected forgeries are stored too (I1.2) |
| `oauth_states` | `state_hash UNIQUE, workspace_id, user_id, code_verifier_enc, expires_at, used_at` | Google OAuth state + PKCE (I3.1), single use, 10 min |
| `slack_link_tokens` | `token_hash UNIQUE, workspace_id, user_id, expires_at, used_at` | one-time code for `/relay link <code>` (I4.3), single use, 10 min |
| `ai_usage_daily` | `workspace_id, day date, tokens int, cost_micros bigint` | Cap check (I6.4) |
| `outbox` | `id, workspace_id NULL, type, payload jsonb, status ('pending'|'in_flight'|'done'|'failed'|'dead'), attempts, max_attempts, available_at, locked_until, last_error, dedupe_key UNIQUE NULL, created_at, done_at` | Outbox job types are listed in `04-integrations.md` §7 |
| `scheduler_state` | singleton: `next_wake_at, qstash_message_id, updated_at` | Global |
| `realtime_events` | `id uuid, workspace_id, topic text, ids uuid[], occurred_at` (index `(workspace_id, occurred_at)`) | Change feed for polling clients (ADR-0003). Written in the same tx as the change; pruned after 10 min |
| `job_runs` | `id, trigger ('qstash'|'cron'|'after'|'nudge'|'dev'|'judge'), started_at, duration_ms, leads_processed, outbox_processed, error` | Heartbeat for Judge Console / integrations page |

## 9. AI, knowledge, audit, demo

| Table | Key columns | Notes |
|---|---|---|
| `ai_settings` | `workspace_id PK, mode ('off'|'suggest'|'standin'), pipeline_modes jsonb, trigger_unacked_seconds, use_business_hours bool, qualifying_questions jsonb, daily_token_cap, daily_cost_cap_micros, version` | F6.1, F6.2, I6.4 |
| `knowledge_entries` | `id, workspace_id, kind ('service'|'area'|'hours'|'faq'|'pricing'|'other'), title, body, locale NULL, updated_by` | Grounding source (F6.5) |
| `audit_events` | `id bigserial, workspace_id, seq bigint, occurred_at, actor_type (enum 'user'|'system'|'ai'), actor_user_id NULL (FK `(workspace_id, actor_user_id)` → users), action (CHECK `<entity>.<verb>` format), target_type, target_id text NULL, before jsonb, after jsonb, meta jsonb, prev_hash bytea, hash bytea` | **Built (T-007, `202610181301_b_audit_events.sql`).** `UNIQUE (workspace_id, seq)`; CHECK user actors have `actor_user_id`. Append-only: `app_user` has SELECT + INSERT only, and triggers `audit_no_update`/`audit_no_truncate` reject changes for every role. BEFORE INSERT trigger `audit_chain` sets `seq`, `prev_hash`, `occurred_at` (DB clock) and `hash = sha256(prev_hash ‖ audit_canonical(row))` under `pg_advisory_xact_lock` per workspace (`06-security.md` §6). SQL helpers `audit_canonical(row)`, `audit_row_hash(row)` are shared by the trigger and `audit.verifyChain()` |
| `test_results` | `id, run_id, req_id, test_name, status, duration_ms, ran_at, source ('ci'|'judge')` | F10.3 (global, read-only for Owners in demo mode) |
| `onboarding_proposals` | `id, workspace_id, input_text, proposal jsonb, status ('draft'|'applied'|'discarded'), created_by` | F9.3. Nothing is applied until confirmed |

## 10. Entity relationships (summary)

```
workspace ─┬─ users ─┬─ sessions
           │         └─ user_roles ── roles
           ├─ teams ── team_members ── users;  teams → escalation_policies → escalation_levels
           ├─ companies ── contacts ─┬─ opportunities ── stages ── pipelines
           │                         ├─ leads ── lead_events            (≤1 open lead per contact)
           │                         ├─ conversations ── messages ── media
           │                         ├─ appointments
           │                         └─ payment_requests ── payments
           ├─ custom_fields ── field_values (→ contact|company|opportunity)
           ├─ tags ── contact_tags / opportunity_tags
           ├─ integration_connections ── integration_events
           └─ audit_events (append-only, hash chained)
```

**Contact owner vs lead owner:** `leads.owner_user_id` is the accountability truth. When a lead is transferred to a **handler** (not fallback custody), `contacts.owner_user_id`, the open opportunity owner and `conversations.assigned_user_id` are updated in the same transaction.

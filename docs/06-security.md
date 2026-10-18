# 06 — Security, Permissions, RLS and Audit

> **Status:** Accepted baseline. Requirement IDs: F1.1–F1.8, F2.11, F2.12, F4.1–F4.4, I1.2, I2.3, I2.8, I5.3, I5.7, I6.1, I6.6, Q1–Q4.
> **Code home:** `packages/core/src/auth/*`, `packages/core/src/audit/*`, `packages/db/sql/*` (roles, RLS, triggers, SECURITY DEFINER functions), `apps/web/lib/http/*` (session, CSRF, error mapping).
> Section numbers are referenced from other docs, so **don't renumber**.

## 1. Authentication (F1.1, F1.2, F1.8, Q1)

### Passwords
- Hash with **argon2id** via `@node-rs/argon2`: `memoryCost: 19456` (19 MiB), `timeCost: 2`, `parallelism: 1` (OWASP minimum). Keep params inside the encoded hash so they can be raised later. Rehash on login if the params changed.
- Minimum 10 characters. Reject the top-1k common passwords (a static list). No other composition rules.
- Signup = create workspace + Owner user + default team, pipeline, roles and templates in **one transaction** (F1.1).

### Sessions (DB-backed)
| Aspect | Rule |
|---|---|
| Token | 32 random bytes, base64url, in cookie `sid`. DB stores only `sha256(token)` in `sessions.token_hash` |
| Cookie flags | `HttpOnly; Secure; SameSite=Lax; Path=/`, `__Host-` prefix in production (`__Host-sid`) |
| Lifetime | Sliding **7 days idle**, **30 days absolute**. `last_seen_at` is updated at most once per 5 min (avoids a write per request) |
| Rotation | New token on login, on privilege change of the user (base level/role change) and on password change. Old row `revoked_at=now()` |
| Validation | `auth_resolve_session(token_hash)` (SECURITY DEFINER, §3) returns user + workspace only if not revoked, not expired, and `users.is_active` |
| Session list | `GET /api/v1/me/sessions` (device, IP, last seen, current flag). `DELETE /api/v1/me/sessions/:id`. Owner: `DELETE /api/v1/users/:id/sessions` ends all of that user's sessions (F1.8) |
| Logout | Revokes the current row and clears the cookie |
| Deactivation | Same tx as `users.is_active=false`: `UPDATE sessions SET revoked_at=now() WHERE user_id=$1` + lead transfers (`03-lead-engine.md` T6). The next request returns 401 |

### Login rate limit (Q1)
Fixed window in `rate_limits`. Keys: `login:ip:<ip>` (20 / 15 min) and `login:email:<sha256(email)>` (5 / 15 min). One statement:
```sql
INSERT INTO rate_limits(key, window_start, count) VALUES ($1, date_trunc('minute', now()) - (extract(minute from now())::int % 15) * interval '1 minute', 1)
ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1 RETURNING count;
```
Over the limit → `429 RATE_LIMITED` with `retryAfter`. Same generic error for unknown email vs wrong password (no user enumeration). A daily outbox job deletes windows older than 1 day. The same helper guards the public form (`form:ip:<ip>` 10/10 min), tick nudges (`nudge:user:<id>` 6/min), invite acceptance and the Slack link start.

### Invites (F1.2)
1. `POST /api/v1/invites { baseLevel, roleId? }` (perm `users.invite`). The level can't exceed the inviter's (only the Owner can invite admins). Creates a random token; stores `sha256` in `invites.token_hash`. Response returns the link `PUBLIC_BASE_URL/{locale}/invite/{token}` **once**. Copy-link is the delivery method.
2. Expires after `workspace.settings.invite_ttl_hours` (default 72). Revocable (`DELETE /api/v1/invites/:id` → `revoked_at`).
3. Accept: `POST /api/v1/invites/accept { token, name, email, password }`. Atomic `UPDATE invites SET used_at=now(), used_by=$u WHERE token_hash=$h AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now() RETURNING *`. 0 rows → `410 INVITE_INVALID`. Creates the user **in that workspace only**. Audited (`user.invited`, `user.joined`).

## 2. Permission catalogue (F1.3, F1.7)

Permissions are strings in `packages/core/src/auth/permissions.ts` (one `as const` array exported to `contracts`). **Never check role names or base levels in feature code.** Always `assertPermission(actor, key)`. Base level is used only for Owner-protection rules.

| Key | Meaning | Owner | Admin | User | Manager role (seeded) |
|---|---|:-:|:-:|:-:|:-:|
| `crm.contact.view` / `.create` / `.edit` / `.delete` | Contacts | ✓ | ✓ | view, create, edit | — |
| `crm.company.view` / `.create` / `.edit` / `.delete` | Companies | ✓ | ✓ | view, create, edit | — |
| `crm.opportunity.view` / `.create` / `.edit` / `.delete` | Opportunities | ✓ | ✓ | view, create, edit | — |
| `crm.opportunity.value.view` | See opportunity value (F1.4) | ✓ | ✓ | ✗ | ✓ |
| `crm.export` | CSV export (F2.11) | ✓ | ✓ | ✗ | — |
| `crm.import` | CSV import (F2.12); also requires `.create` | ✓ | ✓ | ✗ | — |
| `crm.tags.manage` | Create/rename/delete tags | ✓ | ✓ | ✗ | — |
| `crm.config.manage` | Pipelines, stages, custom fields, required fields | ✓ | ✓ | ✗ | — |
| `leads.view_all` | See all leads/contacts/conversations, not just own | ✓ | ✓ | ✗ | ✓ |
| `leads.create` | Manual lead entry | ✓ | ✓ | ✓ | — |
| `leads.reassign` | Manual reassignment (T7) | ✓ | ✓ | ✗ | ✓ |
| `leads.recovery.view` | Recovery queue (F3.7) | ✓ | ✓ | ✗ | ✓ |
| `team.availability.view` | See everyone's status (F3.2) | ✓ | ✓ | ✓ | ✓ |
| `team.availability.manage` | Set *others'* availability | ✓ | ✓ | ✗ | — |
| `routing.manage` | Teams, assignment rules, escalation policy, sources, forms | ✓ | ✓ | ✗ | — |
| `messaging.send` | Reply to customers | ✓ | ✓ | ✓ | — |
| `payments.request` | Create payment links | ✓ | ✓ | ✓ | — |
| `appointments.manage` | Book/reschedule/cancel | ✓ | ✓ | ✓ | — |
| `appointments.override` | Book despite a free/busy overlap (I3.4) | ✓ | ✓ | ✗ | ✓ |
| `integrations.manage` | Connect/change/remove integrations, replay events (I5.7, I5.9) | ✓ | ✓ | ✗ | — |
| `integrations.view` | Integrations page + sync history | ✓ | ✓ | ✗ | — |
| `audit.view` | Audit log + verify integrity (F4.2) | ✓ | ✗ | ✗ | — |
| `ai.manage` | AI mode, knowledge base, templates, caps (F1.3 added) | ✓ | ✓ | ✗ | — |
| `ai.use` | Suggested replies, AI command bar | ✓ | ✓ | ✓ | — |
| `dashboard.company` | Company-wide figures (F5.4) | ✓ | ✓ | ✗ | ✓ |
| `users.invite` | Create/revoke invites | ✓ | ✓ | ✗ | — |
| `users.manage` | Change levels/roles, deactivate, end sessions | ✓ | ✓* | ✗ | — |
| `roles.manage` | Custom roles, level defaults, overrides | ✓ | ✗ | ✗ | — |
| `workspace.settings` | Workspace name, hours, currency, default lead value, time-warp | ✓ | ✓ | ✗ | — |
| `demo.judge_console` | Judge Console, traceability re-run (F10.1, F10.3) | ✓ | ✗ | ✗ | — |

\* Admins hold `users.manage` but the Owner-protection rules below always apply. "—" in the Manager column means "not added by the role" (the user still has their base-level grants). The Manager role is seeded as in F1.7 (view all leads, reassign, recovery queue, team availability) plus value view and company dashboard. The Owner can edit it.

### Owner-protection rules (enforced in `services/users.ts`, independent of permissions)
- Nobody except the Owner can change the Owner's level, roles, sessions or status. Admins cannot grant `roles.manage` or `audit.view`, and cannot create or promote admins.
- The Owner cannot be deactivated or demoted without first `POST /api/v1/workspace/transfer-ownership` (target must be an active admin; atomic; audited).
- A team's `manager_user_id` (the fallback custodian) cannot be deactivated until a replacement is set (F1.8).
- Permission changes take effect on the **next request**: effective permissions are loaded per request from the DB with no caching across requests. The user's sessions are rotated (§1).

### Enforcement API
```ts
assertPermission(actor, 'crm.contact.edit')            // throws AppError FORBIDDEN (403)
can(actor, 'crm.opportunity.value.view')               // boolean, for shaping output
visibleLeadScope(actor) // { all: true } | { ownerUserId: actor.userId }  → added to every list/detail query
```
**Record visibility:** without `leads.view_all`, a User sees leads they own, contacts whose `owner_user_id` is them **or** that have an open lead owned by them, and the conversations, opportunities, payments and appointments of those contacts. Detail endpoints for records outside scope return **404** (not 403), so IDs can't be probed (Q2). The same scope applies to search, saved lists, drill-downs, exports and dashboard counts (F5.3, F5.4).

### Field masking (F1.4): one function, used everywhere
`packages/core/src/auth/mask.ts`:
```ts
export function maskOpportunity<T extends { valueMinor: bigint|null }>(actor: Actor, o: T): T & { valueMasked: boolean }
export function maskMoneyFigure(actor: Actor, minor: bigint|null): { value: bigint|null; masked: boolean }
```
Mandatory call sites (each gets a test): list/detail serializers, CSV export rows, dashboard figures (pipeline value, revenue at risk/rescued, collected revenue), AI task input builders (`ai/context.ts` strips values unless the task needs them **and** the requesting user may see them; I6.6), AI outputs shown to the user, Slack alert renderer (renders per recipient), handoff cards, search results. Realtime is safe by design (hints only). The client never receives the raw value and then hides it. **The masking happens on the server.**

## 3. Row-level security on Neon (F1.6, second layer)

### Roles
| Role | Used by | Attributes |
|---|---|---|
| `neondb_owner` (Neon default; member of `neon_superuser`, effectively **bypasses RLS**) | Migrations only, via `DATABASE_URL_UNPOOLED` | Owns all tables |
| `app_user` | All runtime code (web routes, `runDueWork`, scripts) via pooled `DATABASE_URL` | `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`, **not** owner of any table |

Migration `0001_roles.sql` creates `app_user` if missing (password from `APP_DB_PASSWORD` at migrate time). Neon also allows creating it in the console. `app/api` code **must never** use the owner URL. `config.ts` refuses to boot if `DATABASE_URL`'s user is not `app_user` (the check is skipped in tests that create their own roles).

### Policy template (every workspace-scoped table)
```sql
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;          -- applies even to the owner role's normal queries
CREATE POLICY tenant_isolation ON contacts
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON contacts TO app_user;
```
- `current_setting(..., true)` returns NULL when unset → the comparison is NULL → **no rows**. Forgetting the context fails closed.
- `workspaces` uses `id = current_setting(...)`. Global tables without RLS: `rate_limits`, `scheduler_state`, `job_runs`, `test_results`.
- `audit_events`: `GRANT SELECT, INSERT` only (§6). `lead_events`, `integration_events`: `SELECT, INSERT, UPDATE` (no DELETE).
- A CI check (`scripts/check-rls.ts`) queries `pg_class`/`pg_policies` and fails if any table with a `workspace_id` column lacks `relrowsecurity AND relforcerowsecurity` and a policy.

### Transaction helpers (`packages/db/src/tx.ts`)
```ts
export async function withWorkspaceTx<T>(workspaceId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    // transaction-local: survives PgBouncer transaction pooling, vanishes at COMMIT/ROLLBACK
    await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
    return fn(tx);
  });
}
// No workspace context. May ONLY call SECURITY DEFINER functions + global tables.
export async function withSystemTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> { return db.transaction(fn); }
```
Forbidden: plain `SET app.workspace_id`, `set_config(..., false)`, any query on a workspace table outside these helpers (lint rule: `repos/*` functions take `tx: Tx`, never import `db`).

### SECURITY DEFINER functions (the only cross-workspace doors)
All are owned by the owner role, `SET search_path = pg_catalog, public`, and `REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO app_user`. They return the **minimum** columns.

| Function | Returns | Caller |
|---|---|---|
| `auth_find_user_by_email(email citext)` | `user_id, workspace_id, password_hash, is_active` | Login |
| `auth_resolve_session(token_hash bytea)` | `session_id, user_id, workspace_id, base_level, locale, expires_at` (only valid rows) | Every request |
| `auth_find_invite(token_hash bytea)` | `invite_id, workspace_id, base_level, role_id` (only usable rows) | Invite accept |
| `resolve_connection_key(key text)` | `connection_id, workspace_id, provider` | Webhooks (§7) |
| `resolve_meta_phone_number(phone_number_id text)` | `connection_id, workspace_id` | Meta webhook fallback |
| `resolve_slack_link(token_hash bytea)` / `resolve_slack_user(team_id text, slack_user_id text)` | `user_id, workspace_id` | Slack webhook |
| `public_form_by_slug(slug text)` | `form_id, workspace_id, field defs (labels/types only)` | Public form (F3.1) |
| `claim_due_leads(lim int)` | `id, workspace_id, version` (`FOR UPDATE SKIP LOCKED`) | `runDueWork` |
| `claim_due_outbox(lim int, lease interval)` | `id, workspace_id, type` (sets `status='in_flight', locked_until=now()+lease`) | `runDueWork` |

After resolving `workspace_id`, all further work happens inside `withWorkspaceTx`.

### Testing RLS (see `08-testing.md`)
`[F1.6]` integration tests connect **as `app_user`** and assert: (1) a select with context A never returns B's rows; (2) an insert with B's `workspace_id` under context A fails `WITH CHECK`; (3) no context → 0 rows; (4) a composite-FK insert pointing at B's contact fails; (5) the API `GET /api/v1/contacts/<B id>` as an A user → 404; (6) every SECURITY DEFINER function rejects or ignores cross-tenant misuse.

## 4. Input safety (Q3)

| Threat | Rule |
|---|---|
| Invalid input | Every route handler parses body/query/params with a Zod schema from `contracts`. Unknown keys are stripped (`.strict()` on mutations). IDs are `z.string().uuid()`. Business validation lives in services. **Never trust the client's `workspaceId`.** It always comes from the session |
| SQL injection | Drizzle query builder or `sql\`\`` tagged templates only. No string-concatenated SQL. Saved-list criteria (F2.6) compile from a whitelisted AST (field id, operator enum, typed value) → parameterized SQL |
| XSS | React escaping only. **`dangerouslySetInnerHTML` is banned** (lint) for anything containing user, customer, imported, AI or transcript content. Message bodies render as plain text with a safe linkifier (http/https only, `rel="noopener noreferrer nofollow"`). Slack messages use Block Kit with `mrkdwn` text and every interpolated value is escaped (`&`, `<`, `>`) so customer text cannot inject links or mentions |
| CSRF | Cookie `SameSite=Lax` **plus** (a) an `Origin` (fallback `Referer`) host check against `PUBLIC_BASE_URL` on every non-GET `/api/v1/*`, and (b) double-submit: readable cookie `csrf` (random, not HttpOnly) must equal header `x-csrf-token`. Webhooks, `/api/internal/*` and the public form are exempt from (b) because they use their own auth. The public form uses a per-render token + honeypot + rate limit (F3.1) |
| CSV formula injection (F2.12, F2.11) | On export, any cell starting with `=`, `+`, `-`, `@`, TAB or CR gets a leading `'`. Imported values are stored verbatim, displayed escaped, and neutralized again on export |
| Uploads (CSV, recorded audio) | Max 5 MB CSV / 10 MB audio. Sniff the magic bytes (`file-type`) and allow only `text/csv`, `audio/webm`, `audio/ogg`, `audio/mpeg`, `audio/mp4`. Store in Vercel Blob under a random key. Never serve with the user-supplied filename or content type |
| SSRF | We fetch only provider media via the **provider's** API host (Meta Graph `graph.facebook.com` → returned `lookaside` URL, checked against an allowlist of Meta CDN hosts). No user-supplied URL is ever fetched server-side |
| AI output | Treated as untrusted text. Structured outputs are validated with Zod before use (I6.3). AI can never trigger actions directly (F6.8; tools are not exposed) |
| Headers / CSP | `Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-…'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; frame-ancestors 'none'` (the public form's embed route sets `frame-ancestors *`), plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and `Permissions-Policy: microphone=(self)` |
| Mass assignment | Services accept explicit DTOs, never spread request bodies into DB rows |
| Optimistic locking | Mutations of versioned aggregates require `version` in the body (Q4); stale → `409 STALE_VERSION` |

## 5. Secrets (I5.3, I6.1)

- **Platform secrets** live only in env (Vercel env scopes), are listed in `.env.example` with placeholder values, and are never committed. `.gitignore` covers `.env*` except `.env.example`.
- **Per-workspace integration secrets** (Meta app secret + access token, Stripe secret + webhook secret, Google refresh token, Slack bot token + signing secret if overridden, OpenAI key if overridden) are stored in `integration_connections.secrets_enc` as an AES-256-GCM envelope: `v1 | keyId | iv(12) | ciphertext | tag(16)`. The key is `APP_ENCRYPTION_KEY` (32 bytes base64). The AAD is `connection_id`, so ciphertexts can't be swapped between rows.
- **Rotation:** add `APP_ENCRYPTION_KEY_PREVIOUS`, decrypt with the key matching `keyId`, and run a script that re-encrypts all rows. Document the steps in `12-demo-and-ops.md`.
- Decrypted secrets exist only inside adapter calls. They are never returned by any API: the UI gets `secrets_hint` (last 4), and APIs accept write-only fields.
- **Logging redaction** (`core/log.ts` pino-style redact paths): `authorization`, `cookie`, `set-cookie`, `password`, `password_hash`, `token`, `access_token`, `refresh_token`, `client_secret`, `app_secret`, `api_key`, `x-hub-signature-256`, `stripe-signature`, `upstash-signature`, `x-slack-signature`, `x-slack-request-timestamp`, `secrets_enc`, `card*`. `integration_events.payload_redacted` passes through the same redactor before insert.
- OpenAI calls are server-only (I6.1). The key is never in client bundles; a CI grep fails the build if `OPENAI_API_KEY` appears under `.next/static`.

## 6. Audit log (F4.1–F4.4)

### Append-only enforcement (F4.3)
```sql
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM app_user, PUBLIC;
GRANT SELECT, INSERT ON audit_events TO app_user;
CREATE FUNCTION audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_events is append-only'; END $$;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_immutable();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION audit_immutable();
```
No API route or screen edits or deletes audit rows. A test asserts that `UPDATE`/`DELETE` as `app_user` fails.

### Hash chain (F4.4, P1), computed in the DB so no code path can skip it
```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE FUNCTION audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE last RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit:' || NEW.workspace_id::text));   -- serialize per workspace
  SELECT seq, hash INTO last FROM audit_events WHERE workspace_id = NEW.workspace_id ORDER BY seq DESC LIMIT 1;
  NEW.seq       := COALESCE(last.seq, 0) + 1;
  NEW.prev_hash := COALESCE(last.hash, '\x00'::bytea);
  NEW.occurred_at := COALESCE(NEW.occurred_at, now());
  NEW.hash := digest(NEW.prev_hash || convert_to(audit_canonical(NEW)::text, 'UTF8'), 'sha256');
  RETURN NEW;
END $$;
-- audit_canonical(r) = jsonb_build_object('ws',r.workspace_id,'seq',r.seq,'at',r.occurred_at,'actor_type',r.actor_type,
--   'actor',r.actor_user_id,'action',r.action,'target_type',r.target_type,'target',r.target_id,
--   'before',r.before,'after',r.after,'meta',r.meta)   -- jsonb::text normalizes key order → deterministic
```
- `occurred_at` is cast to text in a fixed format (`to_char(... AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`) inside `audit_canonical`, so the verifier reproduces it exactly.
- **Verify integrity:** `POST /api/v1/audit/verify` (perm `audit.view`) streams rows by `seq` in pages of 1 000. It recomputes each row with the same `audit_canonical` (a SQL function, so it's the same code) and reports `{ ok, checked, firstBrokenSeq, expectedHash, storedHash }`. The Judge Console's demo shows a tamper by having the **owner role** (via a demo-only script, not the app) alter a row, and verify then pinpoints that `seq`.
- The advisory lock serializes audit inserts **per workspace**, not globally. Keep audit appends near the end of a transaction to shorten lock hold time.

### What gets audited (F4.1). `audit.append(tx, {action, targetType, targetId, before?, after?, meta?})`, with the actor taken from context
`lead.assigned|escalated|overdue_attempt|reassigned|claimed|acknowledged|idle_retriggered|critical_flagged|closed`, `user.invited|joined|level_changed|roles_changed|permissions_changed|deactivated|sessions_revoked|availability_changed`, `role.created|updated|deleted`, `workspace.settings_changed|ownership_transferred|time_warp_changed`, `pipeline.*`, `stage.*` (incl. forced move), `field.*`, `tag.*`, `routing.rules_changed`, `escalation_policy.changed`, `integration.connected|updated|disconnected|event_replayed`, `crm.exported` (scope + row count, F2.11), `crm.imported`, `contact|company|opportunity.deleted`, `contact.opted_out`, `ai.settings_changed|mode_changed|standin_started|standin_stopped|handoff`, `knowledge.changed`, `template.changed`, `judge.scenario_run`.
Actor types: `user`, `system` (timers, webhooks), `ai`. `before`/`after` hold only the changed fields, with masked values where the field is protected (the audit viewer re-masks too).

### Viewing (F4.2)
`GET /api/v1/audit?type=&actorUserId=&from=&to=&targetType=&targetId=&cursor=` (perm `audit.view`), keyset-paginated by `seq DESC`. CSV export of the audit log is itself audited.

## 7. Webhook and internal endpoint authentication

| Endpoint | Verification (before **any** state change; constant-time compare via `crypto.timingSafeEqual`) |
|---|---|
| `GET /api/webhooks/meta/:key` | `hub.mode=subscribe` and `hub.verify_token` == the connection's verify token → echo `hub.challenge` (I1.1) |
| `POST /api/webhooks/meta/:key` | `X-Hub-Signature-256` = `sha256=` HMAC-SHA256(app secret, **raw body**) (I1.2) |
| `POST /api/webhooks/stripe/:key` | `stripe.webhooks.constructEvent(rawBody, Stripe-Signature, endpointSecret)` with the default 300 s tolerance (I2.3) |
| `POST /api/webhooks/slack/:key/commands` and `/interactions` | `X-Slack-Signature` = `v0=` HMAC-SHA256(signing secret, `v0:{X-Slack-Request-Timestamp}:{raw body}`), constant-time compare, reject timestamps older than 5 min; optional `team_id` == `SLACK_TEAM_ID`. Interaction button values are additionally signed opaque ids (I4.5) |
| `GET /api/oauth/google/callback` | `state` = signed, single-use, 10-min nonce bound to the user's session (+ PKCE) |
| `POST /api/internal/tick` | Either `Upstash-Signature` verified with `@upstash/qstash` `Receiver` (current + next signing keys, URL-bound), or `Authorization: Bearer $CRON_SECRET` (constant-time). Otherwise 401 |
| `POST /api/internal/test-results` | `Authorization: Bearer $TEST_RESULTS_SECRET` (GitHub Actions) |
| `POST /api/v1/tick-nudge` | Normal session + CSRF + rate limit. Only runs due work, accepts no parameters |
| `GET /api/v1/changes` | Session required. Reads `realtime_events` under RLS (own workspace only). Rows carry topics + ids, never record data; the client refetches through permissioned endpoints |

A failed verification records an `integration_events` row (`status='rejected'`, reason, no payload body beyond size and hash) and returns 401/403. It never returns details about why. An unknown `:key` → 404, with an `integration_events` row whose `workspace_id` is NULL.

## 8. Security checklist for PR review (reviewer agent uses this)

- [ ] Every new route: Zod-parsed input, `requireSession`, `assertPermission`, scope filter, CSRF (mutations), typed errors, no workspaceId from the client.
- [ ] Every new table: `workspace_id NOT NULL`, RLS enabled + forced + policy, grants for `app_user`, composite FKs, `scripts/check-rls.ts` passes.
- [ ] No query outside `withWorkspaceTx`/`withSystemTx`. No `set_config(..., false)` or `SET`. No `LISTEN`.
- [ ] Opportunity value goes through `mask.ts` on every new output path (API, CSV, dashboard, AI input, Slack, handoff card).
- [ ] State changes write `audit.append` for actions in §6 and `lead_events` for lead transitions.
- [ ] External side effects go via the outbox, never awaited inside the lead transaction.
- [ ] Webhooks verify the raw body before parsing and are idempotent on `(provider, external_event_id)`.
- [ ] No `dangerouslySetInnerHTML`. Slack/HTML output is escaped. CSV export is neutralized.
- [ ] No secrets in logs, responses, client bundles or fixtures. `.env.example` is updated for new env vars.
- [ ] Out-of-scope record → 404. Stale version → 409. Rate limits applied on public/auth endpoints.
- [ ] Tests tagged with the requirement IDs touched, including at least one negative (unauthorized / cross-tenant) test.

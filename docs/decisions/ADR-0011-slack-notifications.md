# ADR-0011: Slack for notifications (replaces Telegram)

- **Status:** Accepted
- **Date:** 2026-10-18
- **Requirements touched:** I4.1–I4.5, F3.9, F1.4, F9.2, C4 (read "Telegram" as "Slack"; see `AGENTS.md` §1, Amendment A-1)
- **Supersedes:** the Telegram part of ADR-0007 (its WhatsApp/Meta part stands)

## Context
- `requirements.md` names Telegram as the notification channel. Telegram is not reliably available in Pakistan, where the team and the demo audience are.
- The original hackathon PDF explicitly accepts **Slack, Telegram or email** for I4, so switching is within the brief.
- We still need: per-user linking, alerts within the same minute of an escalation, masked value, an interactive Acknowledge (I4.5), retries and admin-visible failures, at zero cost.

## Decision
Use a **Slack app** in a free Slack workspace behind the existing `Notifier` interface (implementation `core/integrations/slack/`, fake `core/integrations/slack/fake.ts` under `INTEGRATIONS_FAKE=1`, provider key `slack`).

- **Setup:** app manifest at `apps/web/slack/manifest.json`; `pnpm slack:manifest` prints it with the prod base URL filled in (one paste in api.slack.com → "Create app from manifest"). Replaces `pnpm telegram:set-webhook`.
- **Bot scopes:** `chat:write`, `im:write`, `commands`, `users:read`, `users:read.email`.
- **Env:** `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_ID`, `SLACK_TEAM_ID` (optional). Platform defaults; a workspace `integration_connections` row (provider `slack`, encrypted) may override.
- **Inbound:** `POST /api/webhooks/slack/<connectionKey>/commands` (`/relay link <code>`, `/relay help`) and `.../interactions` (Block Kit button clicks). Both verify Slack's v0 HMAC-SHA256 signature over `v0:{timestamp}:{raw body}` in constant time, reject timestamps older than 5 minutes, record idempotently in `integration_events`, and answer within 3 s.
- **Linking (I4.3):** Profile shows "Connect Slack" with a one-time code (`slack_link_tokens`, 10 min). The user runs `/relay link <code>`; we store `users.slack_user_id` + `users.slack_team_id`, open the DM (`conversations.open`) and confirm. Optional auto-link by email via `users.lookupByEmail`, still confirmed by DM.
- **Alerts (I4.1, I4.2, F3.9):** outbox job `slack.send` → `chat.postMessage` Block Kit DM (lead, source, reason, time left, link, value masked via `core/auth/mask.ts`, P1 AI brief). Retries on 429 (`Retry-After`) and 5xx; permanent errors mark the delivery failed and surface to Admins. `slack_channel` + `slack_ts` stored on `slack_alerts` for `chat.update`.
- **Acknowledge button (I4.5, P1):** `action_id: "lead_ack"` with a signed opaque alert id; handler verifies linked user + current owner + still pending, acknowledges via `core/services/leads` (T2), then `chat.update`s the message. Stale clicks get an ephemeral `response_url` reply and change nothing. Audited.

Slack API specifics (methods, scopes, limits, error codes) must be re-verified against current Slack docs at build time.

## Consequences
- Easier: Block Kit buttons, signed requests, free plan, a first-class mobile app, no public bot-username dance.
- Harder: recipients must be members of our Slack workspace; judges must be invited to see alerts live. Demo runs on a teammate's phone with Slack mobile notifications on.
- Users who have not linked Slack are skipped with a visible reason; in-app alerts and the recovery queue still cover them.
- ~1 msg/sec per channel and tiered Web API limits apply; per-user DMs make this a non-issue at demo scale.
- Docs, env vars, tables (`slack_link_tokens`, `slack_alerts`, `users.slack_*`), job names (`slack.send`, `slack.update`) and tasks T-145/T-203/T-207 are updated accordingly. `requirements.md` is unchanged; Amendment A-1 in `AGENTS.md` records the reading.

## Alternatives considered
- Keep Telegram: unreliable in Pakistan; rejected.
- Email: slower to notice and no interactive acknowledgement; rejected (also rejected in ADR-0007).
- Twilio WhatsApp for staff alerts: adds a paid/sandboxed dependency and the 24 h window problem.

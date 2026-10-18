# ADR-0002: Timers and background work on serverless

- **Status:** Accepted
- **Date:** 2026-10-18
- **Requirements touched:** F3.4, F3.5, F3.8, Q5, F6.13, F10.1, F10.2, I4.1

## Context
Acknowledgement windows must fire within seconds (and faster under time-warp). They must never double-fire and must survive restarts. Vercel has no daemons, and Hobby crons run only once a day.

## Decision
- **Postgres is the only source of truth for time**: deadline columns (`leads.escalate_at`, `routing_retry_at`, `idle_check_at`, `outbox.available_at`).
- A stateless, idempotent `runDueWork()` claims due rows (`FOR UPDATE SKIP LOCKED`, via SECURITY DEFINER claim functions) and applies versioned conditional updates.
- It is invoked by: `after()` kicks post-commit; **Upstash QStash** delayed calls scheduled for the *next* deadline (`scheduler_state.next_wake_at`, dedup IDs); authenticated client nudges when a countdown hits zero; a **QStash cron schedule** backstop every 10 min (1 min on demo day), using the same account and signature check; and `scripts/dev-ticker.ts` locally.
- Side effects go through a transactional outbox with leases (`locked_until`) and backoff.

## Consequences
- Correctness doesn't depend on any one trigger. Losing a QStash message delays work until the next nudge or backstop, but never loses it.
- **Interpretation of Q5 / F10.1 "restart the worker mid-countdown":** on serverless every invocation is a fresh process. The Judge Console demonstrates (a) a crash-before-commit that is reprocessed exactly once, and (b) a cancelled wake-up that is still processed by the backstop/nudge. This preserves the requirement's intent.
- Free-tier caps (QStash messages/day, Neon compute hours) are respected by scheduling one wake per next deadline, not per lead.

## Alternatives considered
- Vercel Cron: once/day on Hobby, so too coarse. Pro costs money.
- A long-running worker on another host: free hosts sleep, and it adds ops work.
- Postgres `pg_cron` calling an HTTP endpoint: not reliably available on the Neon free tier; revisit if it becomes available.

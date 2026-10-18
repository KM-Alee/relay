# ADR-0001: Vercel + Neon, TypeScript monorepo

- **Status:** Accepted
- **Date:** 2026-10-18
- **Requirements touched:** Q6, Q13, Q14, Q18, C2

## Context
The team wants to deploy on Vercel (Next.js) with Neon Postgres. Constraints: zero cost (C2), a stable public HTTPS URL for webhooks (Q18), real PostgreSQL (Q6), clear layering (Q14), and a one-command local start (Q13).

## Decision
- Next.js App Router on Vercel (Node runtime, Fluid compute, region `sin1`), project root `apps/web`.
- Neon Postgres in AWS ap-southeast-1, with a branch per preview deployment through the Neon↔Vercel integration.
- pnpm monorepo: `apps/web`, `packages/core` (business logic, no framework imports), `packages/db`, `packages/contracts`.
- Local dev uses Postgres in Docker. Tests run against local Postgres.

## Consequences
- Production gets a stable `*.vercel.app` URL, which satisfies Q18 without tunnels.
- There are no long-running processes, so timers and realtime need serverless-friendly designs (ADR-0002, ADR-0003).
- The pooler's transaction mode constrains how RLS context is set (ADR-0005).
- Hobby plan limits (cron frequency, function duration) must be designed around.

## Alternatives considered
- A single VM + Docker Compose + Cloudflare tunnel: simpler timers, but it isn't what the team wants and is more ops work.
- A separate API server (Fastify) + worker on Railway/Fly: needs paid tiers or sleeps.

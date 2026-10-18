# Relay

**Every lead handed off. None dropped.**

A WhatsApp-first, accountability-first CRM for South Asian SMBs. Every lead always has exactly one accountable human. Leads escalate automatically when ignored. An AI stand-in keeps customers engaged in English, Urdu or Roman Urdu, but never counts as a response.

> *"AI buys time, humans stay accountable."*

Relay is our build of the hackathon's *Unified Business Management Platform* brief ([`requirements.md`](requirements.md)).

**Status:** pre-development. See [`STATUS.md`](STATUS.md). Design system: [`docs/design/`](docs/design/README.md) (Warm Orange). Parallel workflow: [`docs/13-parallel-development.md`](docs/13-parallel-development.md).

## Where to start

| You are… | Read |
|---|---|
| New to the project | [`docs/00-product-overview.md`](docs/00-product-overview.md) |
| An AI agent | [`AGENTS.md`](AGENTS.md), then [`STATUS.md`](STATUS.md) |
| Looking for requirements | [`requirements.md`](requirements.md) (canonical) |
| Looking for docs | [`docs/README.md`](docs/README.md) |
| Building UI | [`docs/design/README.md`](docs/design/README.md) |
| Running agents in parallel | [`docs/13-parallel-development.md`](docs/13-parallel-development.md), `/launch-wave` |

## Stack

Next.js (App Router) on **Vercel** · **Neon** Postgres (RLS) · TypeScript monorepo (pnpm) · Drizzle · Upstash QStash (timer wake-ups + backstop) · polled change feed (realtime) · Vercel Blob · Meta WhatsApp Cloud API · Stripe (test) · Google Calendar · Telegram Bot · OpenAI.

## Quick start (once scaffolded, task T-001)

```bash
pnpm i
cp .env.example apps/web/.env.local
pnpm db:up && pnpm db:migrate && pnpm db:seed
pnpm dev
```

Full setup, provider accounts and the demo-day runbook: [`docs/12-demo-and-ops.md`](docs/12-demo-and-ops.md).

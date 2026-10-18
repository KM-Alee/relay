# Relay

**Every lead handed off. None dropped.**

A WhatsApp-first, accountability-first CRM for South Asian SMBs. Every lead always has exactly one accountable human. Leads escalate automatically when ignored. An AI stand-in keeps customers engaged in English, Urdu or Roman Urdu, but never counts as a response.

> *"AI buys time, humans stay accountable."*

Relay is our build of the hackathon's *Unified Business Management Platform* brief ([`requirements.md`](requirements.md)).

**Live app:** https://relay-eta-silk.vercel.app · **Board:** [`STATUS.md`](STATUS.md) · **Design system:** [`docs/design/`](docs/design/README.md) · **How it works (15-minute read):** [`docs/15-how-it-works.md`](docs/15-how-it-works.md)

## Run it locally in 5 commands

Needs **Node 24** (22.12+ works), **pnpm 10** (`corepack enable`), and **Docker** (for Postgres 16). No provider accounts or API keys are needed: local mode uses fake WhatsApp / Stripe / Google / Slack adapters and AI off.

```bash
pnpm i                              # 1. install
pnpm setup:env                      # 2. writes apps/web/.env.local with fresh secrets + fake providers
pnpm db:up                          # 3. Postgres in Docker (waits until healthy)
pnpm db:migrate && pnpm db:seed     # 4. schema (+ RLS) and two demo workspaces
pnpm dev                            # 5. http://localhost:3000 (web) + a local timer ticker
```

Open http://localhost:3000/dev/login-as and click a user, or sign in at `/login` with password `relay-dev-password`:

| Workspace | Email | Role |
|---|---|---|
| Sunrise Solar | `owner@sunrise.test` | Owner (everything) |
| | `admin@sunrise.test` / `manager@sunrise.test` | Admin / Manager |
| | `user@sunrise.test`, `user2@sunrise.test` | Employees (no value permission, own records only) |
| Crescent Clinic | `owner@crescent.test`, `user@crescent.test` | A second workspace, to prove isolation |

Urdu / RTL: `/ur`. Component gallery: `/dev/kitchen-sink`.

### Real providers (optional)

Edit `apps/web/.env.local`: set `INTEGRATIONS_FAKE=0` and add the keys you have (Stripe test keys, Meta WhatsApp, Google OAuth, Slack, QStash, OpenAI). Every variable is listed in [`.env.example`](.env.example); setup per provider is in [`docs/12-demo-and-ops.md`](docs/12-demo-and-ops.md).

### Tests and checks

```bash
pnpm check        # lint + typecheck + all tests (needs the Docker DB; integration tests use their own relay_test database)
pnpm test:unit    # fast, pure unit tests only
pnpm build        # production build
pnpm e2e          # Playwright (after pnpm dlx playwright install chromium)
```

Troubleshooting: port 5432 busy means another Postgres is running (stop it, or edit `docker-compose.yml`); `pnpm db:reset` wipes and recreates the local database.

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

Next.js (App Router) on **Vercel** · **Neon** Postgres (RLS) · TypeScript monorepo (pnpm) · Drizzle · Upstash QStash (timer wake-ups + backstop) · polled change feed (realtime) · Vercel Blob · Meta WhatsApp Cloud API · Stripe (test) · Google Calendar · Slack Bot · OpenAI.

## More

Full setup, provider accounts and the demo-day runbook: [`docs/12-demo-and-ops.md`](docs/12-demo-and-ops.md).

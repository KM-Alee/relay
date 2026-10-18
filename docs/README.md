# Relay: Docs Index

`requirements.md` (repo root) is canonical. These docs turn it into buildable specs. Keep them in sync with the code (`10-conventions.md` §5).

| # | Doc | What it answers | Read when |
|---|---|---|---|
| 00 | [Product overview](00-product-overview.md) | What and why, personas, core loop, non-negotiables, priorities | First, always |
| 01 | [Architecture](01-architecture.md) | Stack, Vercel/Neon topology, layering, request/webhook lifecycle, serverless timers | Before any code |
| 02 | [Data model](02-data-model.md) | Every table, key columns, constraints | DB / service work |
| 03 | [Lead engine](03-lead-engine.md) | Ownership, routing, ack, escalation, recovery, metrics, invariants | Anything touching leads |
| 04 | [Integrations](04-integrations.md) | Adapters, webhooks, Meta/Stripe/Google/Telegram, outbox job catalogue (§7) | Provider work |
| 05 | [AI](05-ai.md) | AI tasks, stand-in state machine, prompts, safety, cost, voice | AI work |
| 06 | [Security](06-security.md) | Auth, permission catalogue (§2), RLS (§3), input safety, secrets, audit chain (§6) | Auth/permission/DB work, PR review |
| 07 | [Frontend & i18n](07-frontend-i18n.md) | Screen inventory, client patterns, realtime UI, i18n, RTL, a11y, PWA | UI work |
| 08 | [Testing](08-testing.md) | Test layers, requirement tagging, traceability, Judge Console scenarios | Every task |
| 09 | [Build plan](09-build-plan.md) | Milestones, tasks T-xxx with deps and "done when", scope-cut ladder | Picking work |
| 10 | [Conventions](10-conventions.md) | Code style, naming, git, scripts, docs discipline | Every task |
| 11 | [API](11-api.md) | API conventions + endpoint catalogue | Backend/frontend work |
| 12 | [Ops & demo](12-demo-and-ops.md) | Accounts, env vars, setup, deploy, demo-day checklist | Setup / deploy / demo |
| 13 | [Parallel development](13-parallel-development.md) | Lanes, file ownership, contracts-first, worktrees, merge protocol, kickoff prompts | Before launching agents |
| – | [Decisions](decisions/README.md) | ADRs | Before changing architecture |
| – | [Design system](design/README.md) | Warm Orange tokens, components, screens/IA, integration decisions | Before any UI work |

**Reading order for a new agent:** `AGENTS.md` → `STATUS.md` → 00 → 01 → your area's docs (see the table in `AGENTS.md` §2).

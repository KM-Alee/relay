# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/) (pre-1.0 during the hackathon).

**How to add an entry:** every merged task adds one line under `[Unreleased]` in the right group (`Added`, `Changed`, `Fixed`, `Removed`, `Security`, `Docs`), in the form `- Short user-visible description [T-xxx] [Req-IDs]`. When a demo build is tagged, rename `[Unreleased]` to the version and date and start a new `[Unreleased]`.

## [Unreleased]

### Changed
- Changed: notification channel Telegram → Slack (ADR-0011) [I4] [F3.9]

### Docs
- Pre-development documentation set: product overview, architecture (Vercel + Neon), data model, lead engine spec, integrations, AI, security, frontend/i18n, testing/traceability, build plan, conventions, API catalogue, ops/demo runbook [pre-dev]
- ADR-0001..0008: stack, serverless timers, realtime, auth sessions, RLS on Neon, single mutation path, messaging/notification providers, OpenAI-only paid dependency [pre-dev]
- AI workflow: `AGENTS.md`, `CLAUDE.md`, `.claude/agents/*`, `.claude/commands/*`, `STATUS.md`, this changelog, `.env.example` [pre-dev]
- Design system (Warm Orange) integrated into `docs/design/` + ADR-0009. Parallel development playbook (doc 13, ADR-0010, `scripts/wt.sh`, `/launch-wave`), vertical lanes, T-012/T-013. Project named **Relay** [pre-dev]
- Simplified the plan for speed: polled change feed instead of Ably, QStash schedule instead of cron-job.org, open questions resolved, fast-track wave plan [pre-dev]

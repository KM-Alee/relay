# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- **Start every session** by reading `STATUS.md` (a SessionStart hook prints its head). For task work, use `/start-task T-xxx`. When done, use `/finish-task`.
- **Slash commands** (`.claude/commands/`):
  - `/start-task <T-id>`: claim + read the right docs + plan
  - `/finish-task`: DoD checks, STATUS/CHANGELOG update, commit message
  - `/status`: summarize progress, blockers and next tasks
  - `/trace-req <ID>`: find where a requirement is implemented and tested
  - `/adr <title>`: draft a new ADR
  - `/handoff`: write a session-log handoff for the next agent
  - `/launch-wave <Wn>`: orchestrator command that claims the wave's lane tasks and launches one subagent per lane in worktrees
- **Subagents** (`.claude/agents/`): delegate by area.
  - `lead-engine-engineer`: routing, escalation, timers, concurrency (F3, Q5)
  - `backend-engineer`: auth, permissions, CRM services, API (F1, F2, F4, F5)
  - `integrations-engineer`: Meta, Stripe, Google, Telegram, webhooks, outbox (I1–I5)
  - `ai-engineer`: OpenAI tasks, prompts, stand-in, voice (F6, F8, F9, I6)
  - `frontend-engineer`: screens, i18n/RTL, a11y, realtime UI (F7, Q7, Q8, Q17)
  - `qa-engineer`: requirement-tagged tests, baseline acceptance suite, Judge Console (F10)
  - `reviewer`: read-only review against requirements, rules and security, before merge
- For parallel work, prefer **worktrees** (one per task) and launch independent subagents in one message.
- Use the todo list for multi-step tasks. Keep `STATUS.md` as the cross-session source of truth (todos don't persist).
- **Design system: `docs/design/` (Warm Orange, accepted).** Read it before any UI work. Tokens only, no raw colours.
- **Parallel work:** follow `docs/13-parallel-development.md` (lanes, file ownership, contracts-first, worktrees via `scripts/wt.sh` or `isolation: "worktree"`).

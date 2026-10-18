# Architecture Decision Records

One file per significant decision: `ADR-NNNN-kebab-title.md`, numbered sequentially and never renumbered. To change a decision, write a **new** ADR that supersedes the old one, and set the old one's status to `Superseded by ADR-XXXX`.

| ADR | Title | Status |
|---|---|---|
| [0001](ADR-0001-vercel-neon-monorepo.md) | Vercel + Neon, TypeScript monorepo | Accepted |
| [0002](ADR-0002-serverless-timers.md) | Timers and background work on serverless (DB truth + QStash + backstop) | Accepted |
| [0003](ADR-0003-realtime-polled-change-feed.md) | Realtime via a polled change feed (`realtime_events`) | Accepted |
| [0004](ADR-0004-auth-db-sessions.md) | Own DB sessions; one workspace per user | Accepted |
| [0005](ADR-0005-rls-on-neon.md) | Tenant isolation with RLS on Neon's pooler | Accepted |
| [0006](ADR-0006-no-server-actions.md) | One mutation path: `/api/v1` route handlers, no Server Actions | Accepted |
| [0007](ADR-0007-meta-whatsapp-telegram.md) | Meta WhatsApp Cloud API + Telegram (Twilio waived) | Accepted |
| [0008](ADR-0008-openai-only-paid.md) | OpenAI as the only paid dependency; AI is optional by design | Accepted |
| [0009](ADR-0009-design-system-ui-stack.md) | Design system: Warm Orange tokens on shadcn/ui | Accepted |
| [0010](ADR-0010-parallel-development.md) | Parallel development: lanes, contracts-first, conflict-free file layout | Accepted |

Template: copy `ADR-template.md`.

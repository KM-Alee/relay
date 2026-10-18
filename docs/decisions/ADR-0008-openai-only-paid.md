# ADR-0008: OpenAI as the only paid dependency; AI optional by design

- **Status:** Accepted
- **Date:** 2026-10-18
- **Requirements touched:** C2, C3, I6, Q15, F6.11, C20

## Context
The team has an OpenAI key. All AI features use it. The P0 baseline must pass with AI off.

## Decision
- All AI calls are made server-side through the `AIProvider` adapter, with models set per task by env, structured outputs validated with Zod, a daily cap per workspace, and every call logged as an integration event.
- AI work runs from the outbox or after commit. **The lead flow never awaits AI.**
- `AI_ENABLED=false` is a supported, tested configuration.

## Consequences
- A separate test suite runs with AI disabled.
- Prompt changes are versioned files and reviewed like code.

## Alternatives considered
- Local or open models: adds hosting, and Urdu quality is uncertain.

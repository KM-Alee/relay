---
description: Trace a requirement ID to its spec, implementation and tests
argument-hint: <requirement ID e.g. F3.8>
---
Trace requirement **$ARGUMENTS**.

1. Quote its row from `requirements.md` (ID, priority, acceptance criteria).
2. Find where the docs specify it: `grep -rn "$ARGUMENTS" docs/`.
3. Find the implementation: `grep -rn "$ARGUMENTS" packages apps` (code comments reference IDs) and the build-plan task(s) that cover it.
4. Find the tests: titles containing `[$ARGUMENTS]`. If a test report exists, show their last status.
5. Verdict: **Covered / Partially covered / Not covered**, with the gap list (each acceptance-criterion clause → evidence or missing). Suggest the minimal tests or code needed to close each gap.

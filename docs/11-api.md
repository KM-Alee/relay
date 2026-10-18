# 11 — HTTP API

> **Status:** Accepted conventions + **initial** endpoint catalogue. Add endpoints here when you build them. Zod schemas live in `packages/contracts/src/api/*`; this doc is the human index.
> Requirement anchors: F1.5, Q2, Q3, Q10, I5.

## 1. Conventions

- Base path `/api/v1`. JSON only. Auth via the session cookie `sid` (httpOnly, Secure, SameSite=Lax).
- **Mutations** (`POST/PATCH/PUT/DELETE`) require the `x-csrf-token` header (double-submit against the `csrf` cookie) and a matching `Origin`. Webhooks and `/api/internal/*` are exempt and use their own signature auth.
- Every handler is `route({ auth, permission?, body?, query?, params?, rateLimit?, status?, handler })` from `apps/web/lib/http/route.ts`. Order: CSRF (unsafe methods) → session → Actor (`lib/http/session.ts#resolveActor`, filled by T-101) → declared permission → rate limit (`{ name, limit, windowSeconds, by: 'ip'|'user' }` → key `<name>:<ip|user>:<id>`) → Zod-parse params/query/body (body must be `application/json`, else 415) → `handler` (one service call; returns data → JSON, or a raw `Response`) → errors via `toErrorResponse()`. Services return already-masked DTOs (`core/auth/mask.ts`, T-102). All responses: `Cache-Control: no-store`.
- **CSRF token**: `GET /api/v1/csrf` (public) issues the readable `csrf` cookie (`<nonce>.<hmac>` signed with `SESSION_SECRET`); `route()` also re-issues it on any response when the caller's cookie is missing/invalid. The client echoes it in `x-csrf-token`.
- **Optimistic locking**: `PATCH` bodies include `version`. A mismatch returns `409 { code: 'STALE_VERSION', current }`.
- **Pagination**: cursor-based: `?cursor=&limit=` (max 100) → `{ items, nextCursor }`. Lists with hundreds of rows must paginate (Q9).
- **Filtering**: `?filter=<base64url JSON criteria>` using the same criteria schema as saved lists (F2.6). The server validates the fields and the caller's permission to filter on them (e.g. no filtering on value without `crm.opportunity.value.view`).
- **Errors**: `{ error: { code, message, i18nKey, details? } }` (catalogue: `packages/contracts/src/errors.ts`; messages: `apps/web/messages/{en,ur}/errors.json`, one key per code; client helper `apps/web/lib/http/client-error.ts`) with the proper status: 400 validation, 401 unauthenticated, 403 forbidden, 404 not found **(also for other workspaces' IDs; never reveal existence)**, 409 conflict/state changed, 422 business rule (e.g. `REQUIRED_FIELDS_MISSING`), 429 rate limited (`details.retryAfter` seconds + `Retry-After` header), 503 provider unavailable. Codes today: `VALIDATION_FAILED` 400 (`details.issues[{path, code}]`, values never echoed), `UNAUTHENTICATED` 401, `FORBIDDEN` / `CSRF_FAILED` 403, `NOT_FOUND` 404, `CONFLICT` / `STALE_VERSION` / `LEAD_STATE_CHANGED` / `ALREADY_CLAIMED` 409, `INVITE_INVALID` 410, `PAYLOAD_TOO_LARGE` 413, `UNSUPPORTED_MEDIA_TYPE` 415, `REQUIRED_FIELDS_MISSING` / `BUSINESS_RULE_VIOLATION` 422, `RATE_LIMITED` 429, `INTERNAL` 500 (generic; details only in server logs), `PROVIDER_UNAVAILABLE` 503; client-only `NETWORK_ERROR`. Add new codes additively.
- **Idempotent creates** accept `clientKey` (send message, payment link, appointment).
- Times are ISO 8601 UTC. Money is `{ amountMinor, currency }`, or `{ masked: true }` when hidden (F1.4).

## 2. Endpoint catalogue (initial)

### Auth & session (F1.1, F1.2, F1.8)
| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/auth/signup` | public, rate-limited | creates workspace + Owner |
| POST | `/auth/login` · `/auth/logout` | public / session | rate-limited (Q1) |
| GET | `/me` | session | actor, permissions, locale, flags |
| GET / DELETE | `/me/sessions` · `/me/sessions/:id` | session | list / revoke own |
| POST | `/invites` · DELETE `/invites/:id` | `users.invite` | returns the copyable link once |
| POST | `/invites/:token/accept` | public | single-use |

### Users, roles, teams (F1.2–F1.8, F3.2)
| Method | Path | Permission |
|---|---|---|
| GET / PATCH | `/users` · `/users/:id` | `users.manage` (self for own profile/availability) |
| POST | `/users/:id/deactivate` | `users.manage` (guards per F1.8) |
| DELETE | `/users/:id/sessions` | Owner |
| PATCH | `/users/:id/availability` | self or `users.manage` |
| CRUD | `/roles`, `/level-permissions`, `/users/:id/permission-overrides` | `roles.manage` |
| CRUD | `/teams`, `/teams/:id/members` | `routing.manage` |
| CRUD | `/escalation-policies` (+ levels) | `routing.manage` |

### CRM (F2)
| Method | Path | Permission |
|---|---|---|
| CRUD | `/contacts`, `/companies`, `/opportunities` | `crm.<entity>.view/create/edit/delete` |
| POST | `/opportunities/:id/move` `{stageId, version}` | `crm.opportunity.edit` (+ required fields F2.4) |
| CRUD | `/pipelines`, `/pipelines/:id/stages`; DELETE stage needs `{moveToStageId}` | `crm.config.manage` |
| CRUD | `/custom-fields` | `crm.config.manage` |
| CRUD | `/tags` | `crm.tags.manage` (attach/detach: entity `.edit`) |
| CRUD | `/saved-lists`; GET `/saved-lists/:id/items` | `crm.*.view` |
| POST | `/activities` (note, call) | `crm.contact.edit` |
| GET | `/contacts/:id/timeline` | `crm.contact.view` |
| POST | `/exports` `{entity | savedListId}` → CSV stream | `crm.export` (audited) |
| POST | `/imports` (P1) → mapping → `/imports/:id/commit` | `crm.import` + `crm.contact.create` |

### Leads (F3) — spec in `03-lead-engine.md`
| Method | Path | Permission | Transition |
|---|---|---|---|
| GET | `/leads` (`?view=mine|all`), `/leads/:id` (incl. trace, events) | own or `leads.view_all` | |
| POST | `/leads` | `leads.create` | T1 manual intake |
| POST | `/leads/:id/acknowledge` `{version}` | owner | T2 |
| POST | `/leads/:id/reassign` `{toUserId, override?, reason?}` | `leads.reassign` | T7 |
| POST | `/leads/:id/claim` (P1) | eligible user | T8 |
| POST | `/leads/:id/take-over` | custodian (if eligible) | §11 Q3 |
| POST | `/leads/:id/urgent` | owner or `leads.reassign` | F3.12 |
| GET | `/recovery-queue` | `leads.recovery.view` | §7 |
| GET | `/notifications`; POST `/notifications/read` | session | F3.4 |
| POST | `/tick-nudge` | session, rate-limited | runs due work only |

### Public (no auth)
| Method | Path | Notes |
|---|---|---|
| GET | `/f/:slug` (page) · POST `/api/public/forms/:slug` | honeypot + per-IP rate limit; returns `{ok, bookingAvailable}` (F3.1, I3.8) |
| GET / POST | `/api/public/forms/:slug/slots` · `/book` (P1) | handler slots only (I3.8) |

### Conversations & payments & calendar (I1–I3)
| Method | Path | Permission |
|---|---|---|
| GET | `/conversations`, `/conversations/:id/messages` | visibility per I1.6 |
| POST | `/conversations/:id/messages` `{body | templateKey, clientKey}` | `messaging.send` + record visibility; blocked if opted-out / window closed (I1.9, I1.10) |
| POST | `/messages/:id/retry` | same |
| POST | `/payment-requests` `{opportunityId, amountMinor, currency, sendVia?}` | `payments.request` |
| GET | `/calendar/:userId/availability?from&to` | `appointments.manage` |
| CRUD | `/appointments` | `appointments.manage` (overlap override: `appointments.override`) |
| GET | `/media/:id` (under `/api`) | visibility of the owning message |

### Integrations, AI, audit, demo
| Method | Path | Permission |
|---|---|---|
| GET / POST / DELETE | `/integrations`, `/integrations/:provider/connect` | `integrations.manage` |
| GET | `/integrations/google/connect` → Google consent (PKCE, `oauth_states`) | session (own calendar) |
| GET | `/api/integrations/google/callback` (outside `/v1`) | state-verified, single use |
| GET | `/integration-events` | `integrations.view` |
| POST | `/integration-events/:id/replay` (P1) | `integrations.manage` |
| POST | `/me/telegram-link` → deep link | session |
| GET / PATCH | `/ai/settings`, CRUD `/knowledge`, `/templates` | `ai.manage` |
| POST | `/conversations/:id/suggestions` (P2) | `ai.use` + `messaging.send` |
| POST | `/ai/onboarding-proposals` · `/:id/apply` | Owner |
| GET | `/audit` · POST `/audit/verify` | `audit.view` |
| GET | `/dashboard/metrics?figures=` · `/dashboard/drilldown/:figure` | session; company-wide needs `dashboard.company` (F5.4) |
| POST | `/judge/:scenario` | `demo.judge_console` + `demo_mode` |
| PATCH | `/workspace/time-warp` | `workspace.settings` + `demo_mode` |
| GET | `/traceability` · POST `/traceability/rerun` | `demo.judge_console` + `demo_mode` |
| POST | `/workspace/transfer-ownership` | Owner only (`06-security.md` §2) |
| GET | `/changes?since=<ISO>` | session (realtime change feed, own workspace; `07-frontend-i18n.md` §2) |
| POST | `/ai/transcribe` (P2 push-to-talk) | session, rate-limited |

### Webhooks & internal (no session; signature-authenticated)
| Path | Auth |
|---|---|
| `GET/POST /api/webhooks/meta/:connectionKey` | GET verify-token handshake; POST `X-Hub-Signature-256` |
| `POST /api/webhooks/stripe/:connectionKey` | `Stripe-Signature` |
| `POST /api/webhooks/telegram/:connectionKey` | `X-Telegram-Bot-Api-Secret-Token` |
| `POST /api/internal/tick` | QStash signature **or** `Bearer CRON_SECRET` |
| `POST /api/internal/test-results` | `Bearer TEST_RESULTS_SECRET` (from CI) |
| `GET /api/health` | public, no data |

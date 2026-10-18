# 11 — HTTP API

> **Status:** Accepted conventions + **initial** endpoint catalogue. Add endpoints here when you build them. Zod schemas live in `packages/contracts/src/api/*`; this doc is the human index.
> Requirement anchors: F1.5, Q2, Q3, Q10, I5.

## 1. Conventions

- Base path `/api/v1`. JSON only. Auth via the session cookie `sid` (HttpOnly, SameSite=Lax, Path=/; `__Host-sid` + Secure in production; 30 d absolute, 7 d idle).
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
| POST | `/auth/signup` | public, rate-limited (10/h per IP) | **Built (T-101).** `{workspaceName, name, email, password, locale?, timezone?}` → 201 `MeResponse` + `Set-Cookie sid`. `EMAIL_TAKEN` 409; weak password → 400 `issues[{path:'password', code:'password_too_short'|'password_too_common'}]` |
| POST | `/auth/login` · `/auth/logout` | public | **Built (T-101).** Login → `MeResponse` + new `sid` (previous cookie's session revoked); limits `login:ip` 20/15 min + `login:email:<sha256>` 5/15 min → 429; unknown email / wrong password / deactivated → `INVALID_CREDENTIALS` 401. Logout → 204, clears cookie (always) |
| GET | `/me` | session | **Built.** `{ user{id, workspaceId, baseLevel, locale, name, email, timezone, availability}, workspace{id, name, slug, timezone, currency, defaultLocale, demoMode}, permissions, flags }` |
| GET / DELETE | `/me/sessions` · `/me/sessions/:id` | session | **Built (T-101).** List own live sessions (`current` flag) / revoke own (other ids → 404; audited `user.sessions_revoked`) |
| POST | `/invites` · DELETE `/invites/:id` | `users.invite` | returns the copyable link once |
| POST | `/invites/:token/accept` | public | single-use |

### Users, roles, teams (F1.2–F1.8, F3.2)
| Method | Path | Permission |
|---|---|---|
| GET / PATCH | `/users` · `/users/:id` | `users.manage` (self for own profile/availability). **GET built (T-102)**: keyset `?cursor&limit` → `{items: UserSummary[], nextCursor}`; other workspace's id → 404 |
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

**As built (T-110…T-118, Lane B; contracts `contracts/api/crm.ts`, fixtures off):** lists are keyset `?cursor&limit` (+ `q`, `filter`); out-of-scope or other-workspace ids → 404; stale `version` → 409 `STALE_VERSION` with `details.current` (the masked DTO). Opportunity `value` is `{masked:true}` or `{masked:false, amountMinor, currency}` (via `core/auth/mask.ts`); setting a value needs `crm.opportunity.value.view`.
| Method | Path | Notes |
|---|---|---|
| GET / POST | `/contacts` · `/companies` · `/opportunities` | list (`q`, `filter`, `companyId` / `pipelineId` / `stageId` / `contactId`) · create (201; phone normalised to E.164; duplicate phone/email → 409 `CONFLICT` `{field}`) |
| GET / PATCH / DELETE | `/contacts/:id` · `/companies/:id` · `/opportunities/:id` | PATCH needs `version`; DELETE = soft delete (audited; a contact's opportunities go with it, a company's contacts are unlinked) |
| GET | `/contacts/:id/360` | contact + company + opportunities + `related{conversations,payments,appointments}` (filled by Lane C via `registerContact360Provider`) + first timeline page |
| GET | `/contacts/:id/timeline` · `/opportunities/:id/timeline` | newest first; AI entries carry `ai:true` |
| POST / DELETE | `/contacts/:id/tags` `{tagId}` · `/contacts/:id/tags/:tagId` (same for `/opportunities`) | attach is idempotent; returns the record |
| POST | `/opportunities/:id/move` `{stageId, version, fields?}` | 422 `REQUIRED_FIELDS_MISSING` `details{stageId, fields[{fieldId,key,label,entity}]}`; `fields` fills them in the same atomic request |
| GET / POST | `/pipelines` · PATCH / DELETE `/pipelines/:id` | DELETE only an empty, non-default pipeline (422 `BUSINESS_RULE_VIOLATION`) |
| GET | `/pipelines/:id/board?filter&q` | columns `{stage, count, total (masked figure), opportunities (≤50)}` |
| POST | `/pipelines/:id/stages` · `/pipelines/:id/stages/reorder` `{stageIds}` | |
| PATCH / DELETE | `/stages/:id` | DELETE `{moveToStageId?}`: a non-empty stage without a target → 422 `BUSINESS_RULE_VIOLATION` `{reason:'move_target_required'}`; with it, opportunities move + `stage_change` activities + audit in one tx |
| GET / POST / PATCH / DELETE | `/custom-fields` (`?entity&pipelineId`) | `pipelineId` null = shared; DELETE cascades values + required links and rewrites saved lists (`needsReview`) |
| GET / POST / PATCH / DELETE | `/tags` | DELETE cascades joins and cleans saved lists |
| GET / POST / PATCH / DELETE | `/saved-lists` · GET `/saved-lists/:id/items` | own + shared lists; items are evaluated LIVE with the viewer's scope and masking |
| POST | `/activities` `{contactId\|opportunityId, type:'note'\|'call', body, direction?, outcome?, durationSeconds?}` | counts as a human action: `onHumanAction` hook (see `core/services/crm-activity.ts`) |
| POST | `/exports` `{entity\|savedListId, filter?}` | `crm.export`; UTF-8 CSV (BOM), formula-injection guard, masked value cells, audited `crm.exported` `{scope,rowCount}`; cap 50,000 rows |

**Filter criteria** (`?filter=` base64url JSON, same schema as saved lists): `{match:'all'|'any', clauses[]}` with `tag`, `owner`, `stage`, `pipeline`, `company`, `name`, `value` (needs the value permission, else 403), `created_at`/`last_activity_at`/`stage_entered_at` (`before|after|older_than_days|within_days`) and `custom` (`fieldId` + op by field type). Invalid clauses → 400; unsupported field for the entity → 400.

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
| POST | `/me/slack-link` → one-time `/relay link <code>` (10 min) · DELETE `/me/slack-link` unlinks | session |
| GET / PATCH | `/ai/settings`, CRUD `/knowledge`, `/templates` | `ai.manage` |
| POST | `/conversations/:id/suggestions` (P2) | `ai.use` + `messaging.send` |
| POST | `/ai/onboarding-proposals` · `/:id/apply` | Owner |
| GET | `/audit` (T-151) · POST `/audit/verify` | `audit.view`. **`/audit/verify` built (T-007)**: `{ ok, checked, firstBrokenSeq, expectedHash, storedHash }` (hex), rate-limited 6/min per user |
| GET | `/dashboard/metrics?figures=` · `/dashboard/drilldown/:figure` | session; company-wide needs `dashboard.company` (F5.4) |
| POST | `/judge/:scenario` | `demo.judge_console` + `demo_mode` |
| PATCH | `/workspace/time-warp` | `workspace.settings` + `demo_mode` |
| GET | `/traceability` · POST `/traceability/rerun` | `demo.judge_console` + `demo_mode` |
| POST | `/workspace/transfer-ownership` | Owner only (`06-security.md` §2) |
| GET · POST | `/api/dev/login-as` (outside `/v1`) `{userId}` → session for a seed user (T-010) | dev only: 404 unless `NODE_ENV=development` + `DEMO_MODE` (13 §5) |
| GET | `/changes?since=<ISO>` | session (realtime change feed, own workspace; `07-frontend-i18n.md` §2). Response `{now, reset, changes:[{id, topic, ids, at}]}`; no `since` returns just a cursor; `reset:true` = refetch everything (cursor older than 10 min or more than 500 hints). Contract: `contracts/api/realtime.ts` |
| POST | `/ai/transcribe` (P2 push-to-talk) | session, rate-limited |

### Webhooks & internal (no session; signature-authenticated)
| Path | Auth |
|---|---|
| `GET/POST /api/webhooks/meta/:connectionKey` | GET verify-token handshake; POST `X-Hub-Signature-256` |
| `POST /api/webhooks/stripe/:connectionKey` | `Stripe-Signature` |
| `POST /api/webhooks/slack/:connectionKey/commands` · `/interactions` | `X-Slack-Signature` + `X-Slack-Request-Timestamp` (v0 HMAC, 5 min window) |
| `POST /api/internal/tick` | QStash signature **or** `Bearer CRON_SECRET` |
| `POST /api/internal/test-results` | `Bearer TEST_RESULTS_SECRET` (from CI) |
| `GET /api/health` | public, no data |

# 07 — Frontend, Localization (en/ur, RTL) and Accessibility

> **Status:** Accepted for **structure and behaviour**. Requirement IDs: F5.*, F7.1–F7.7, Q7–Q11, Q16, Q17, F9.4, F2.10, F10.*.
> **Code home:** `apps/web/app/[locale]/*`, `apps/web/components/*`, `apps/web/lib/{query,realtime,i18n,format}/*`, `apps/web/messages/{en,ur}.json`.

> 🎨 **Design system: accepted (Warm Orange).** Visual rules live in **`docs/design/`**: `README.md` (decisions) → `tokens.md` → `components.md` → `screens.md`. This doc covers structure and behaviour; `docs/design/` covers the look. If they conflict on visuals, `docs/design/` wins. On behaviour or requirements, this doc and `requirements.md` win.

## 1. Route map / screen inventory

All app routes live under `/[locale]` (`en` | `ur`). The gate is checked **server-side** in the page (redirect or 404) **and** again by every API the page calls. The UI hides controls that the user lacks permission for, but that hiding is a convenience, not security (F1.5).

| Route | Screen | Req IDs | Gate (perm) |
|---|---|---|---|
| `/login`, `/signup`, `/invite/[token]` | Auth, invite accept | F1.1, F1.2 | public |
| `/onboarding` | Describe-your-business (AI) + templates (Real estate / Solar / Clinic) → review → confirm | F9.3 | Owner, `workspace.settings` |
| `/` (Overview, tab `Summary`) | Homepage per `design/screens.md` §2: header sentence, 2 alert chips, 3 KPIs, primary chart, secondary cards; drill-down, show/hide per user | F5.1–F5.5, F5.7–F5.9 | any; company figures need `dashboard.company`; values need `crm.opportunity.value.view` |
| `/?tab=radar` (Overview tab `Radar`) | Lead Radar: team avatars + status rings, lead countdown rings, live escalation animation | F5.6, F3.2 | `team.availability.view` |
| `/leads`, `/leads/[id]` | Lead list (filters, state chips) and lead detail: owner, custody banner, countdown, routing trace, events, Acknowledge, Reassign, Claim | F3.*, F3.11 | own or `leads.view_all`; reassign `leads.reassign` |
| `/leads/new` | Manual lead entry with source picker | F3.1 | `leads.create` |
| `/recovery` | Recovery queue with reasons; P1 Claim (pond) | F3.7 | `leads.recovery.view` |
| `/contacts`, `/contacts/[id]` | List + saved lists; **complete customer view**: conversations, opportunities, payments, appointments, owner, activity, AI profile | F2.1, F2.6–F2.8, F2.13 | `crm.contact.view` + scope |
| `/companies`, `/companies/[id]` | Companies | F2.1 | `crm.company.view` |
| `/opportunities/[id]` | Opportunity detail: stage, required fields, value (masked), payment requests, appointments | F2.4, I2.*, I3.* | `crm.opportunity.view` |
| `/pipeline` (`?p=<pipelineId>`) | Board (drag between stages, rot indicators, health) + list toggle | F2.5, F2.9, F9.6 | `crm.opportunity.view` |
| `/lists/[id]` + "Work this list" mode | Saved list; P2 sequential mode | F2.6, F2.10 | scope |
| `/inbox`, `/inbox/[conversationId]` | Conversations: thread, AI labels, delivery ticks, 24 h window indicator, opt-out banner, composer (templates outside window), $ button, book button, voice note bubbles + transcript, handoff card, suggested replies | I1.*, F6.*, F8.*, I2.1, F9.5 | `messaging.send` to reply; scope |
| `/appointments` | Agenda + booking dialog with free/busy | I3.3–I3.7 | `appointments.manage` |
| `/payments` | Payment requests + statuses; collected vs projected | I2.5–I2.7 | `payments.request` (values per F1.4) |
| `/settings/workspace` | Name, timezone, currency (PKR), business hours, default lead value, time-warp | F7.4, F10.2 | `workspace.settings` |
| `/team` (+ `/team/users`) | Users, invites, levels, roles, deactivate, end sessions | F1.2, F1.7, F1.8 | `users.manage` / `users.invite` |
| `/settings/roles` | Custom roles, level defaults, per-user overrides | F1.3, F1.7 | `roles.manage` |
| `/automations/teams` | Members, manager, backup, capacity, skills, availability of others | F3.2, F3.3, F3.5 | `routing.manage` |
| `/automations/assignment` | Assignment mode, windows, retry, idle, urgent window, idle re-trigger toggle | F3.3, F3.4, F3.10, F3.12 | `routing.manage` |
| `/automations` | RuleSummary guided editor (= P0 basic form); P1 FlowCanvas policy builder + TestPanel + Publish (`design/components.md` §6) | F3.5 | `routing.manage` |
| `/settings/pipelines`, `/settings/fields`, `/settings/tags` | Stages (add/rename/reorder/delete-with-move, rot period, required fields), custom fields (incl. AI field), tags | F2.2–F2.5, F2.9, F9.1, F2.1 | `crm.config.manage` / `crm.tags.manage` |
| `/automations/forms`, `/automations/sources` | Web forms (fields, slug, embed snippet), manual sources | F3.1 | `routing.manage` |
| `/settings/ai`, `/settings/knowledge`, `/settings/templates` | AI mode, triggers, qualifying questions, caps; knowledge base; localized templates | F6.1–F6.5, I6.4, F7.6 | `ai.manage` |
| `/settings/integrations`, `/settings/integrations/[id]/events` | Status, last OK, errors, AI spend today, limits text, connect/disconnect; sync history + replay | I5.1–I5.9 | `integrations.view` / `.manage` |
| `/audit` | Audit log with filters + Verify integrity | F4.2, F4.4 | `audit.view` |
| `/judge` | Judge Console scenarios (expected vs actual) | F10.1 | `demo.judge_console` + `workspace.demo_mode` |
| `/traceability` | Requirement → test → last run → status; re-run | F10.3 | `demo.judge_console` |
| `/me` | Profile: language, timezone, theme, sound mute, availability, Connect Slack (one-time code for `/relay link <code>`; unlink), Google Calendar connect, sessions | F7.1, F3.2, I4.3, I3.1, F1.8 | self |
| `/f/[formSlug]` (no locale prefix, no auth) | Public web form + thank-you + P1 instant booking | F3.1, I3.8 | public, rate-limited |

Navigation is built from a single `nav.ts` config with `{ href, labelKey, icon, perm, group: 'primary'|'more' }`. Primary: Overview · Leads · Inbox · Pipeline · Recovery · Automations. More: Appointments · Payments · Team · Integrations · Audit log · Settings · Judge Console (`design/screens.md` §1). Entries the user lacks permission for are omitted.

## 2. App shell and component architecture

- **Server Components** for page shells and the first data load (calling `core/services` with the session actor). **Client Components** for anything interactive or live (boards, inbox, radar, countdowns, forms). Pass server-fetched data as `initialData` to TanStack Query so the first paint never shows a spinner.
- All mutations go from client → `/api/v1/*` via `lib/api.ts` (`fetchJson` adds `x-csrf-token`, parses `AppError`, and maps it to an i18n key). No Server Actions.
- Folders: `components/ui/*` (primitives; restyled when the design arrives), `components/domain/*` (LeadCard, CountdownRing, RoutingTrace, MessageBubble, HandoffCard, StatTile, …), `features/<area>/*` (screen-level composition).
- Forms: `react-hook-form` + `zodResolver` using the **same** schema from `contracts` that the server uses. Server errors map back to fields through `details.fieldErrors`.

### Query keys (one convention, used by realtime invalidation)
```ts
// lib/query/keys.ts
qk.leads.list(filters)  → ['leads', 'list', filters]
qk.leads.detail(id)     → ['leads', 'detail', id]
qk.recovery()           → ['recovery']
qk.radar()              → ['radar']
qk.conversations.list(f)/.detail(id)/.messages(id)
qk.contacts.*  qk.opportunities.*  qk.dashboard(figureKey)  qk.notifications()  qk.integrations()
```
**The topic is always the first segment.** Realtime hint topics (`leads`, `recovery`, `radar`, `conversations`, `messages`, `contacts`, `opportunities`, `payments`, `appointments`, `dashboard`, `notifications`, `integrations`, `team`) map 1:1 to that first segment.

### Realtime hook (Q11)
```ts
// lib/realtime/useRealtime.ts (mounted once in the app shell)
// 1. poll GET /api/v1/changes?since=<lastNow> every 2 s (1 s while Lead Radar or a countdown is on screen);
//    pause while document.hidden; on focus, poll immediately
// 2. for each change {id, topic, ids} not seen before (keep the last ~500 ids):
//    queryClient.invalidateQueries({queryKey:[topic]}), or narrower when ids are given (['leads','detail',id]);
//    coalesce bursts with a 250 ms debounce per topic
// 3. store `now` from the response as the next `since` (server clock, so no client skew)
// 4. after 3 consecutive poll failures, show a small "Live updates paused" indicator; keep retrying with backoff
```
Payloads never contain data, only hints (architecture rule 5). New-lead / escalation / payment hints also feed the toast + optional sound cue system.

## 3. State patterns (Q10, Q17)

| Situation | Pattern |
|---|---|
| Loading | Skeletons shaped like the content. No full-page spinners after first paint. Slow AI or transcription shows inline progress while the rest stays usable (Q9) |
| Mutation | Optimistic update for stage move, acknowledge, availability, tag edits and message send, with rollback on error and a toast explaining the error |
| Errors | Toast/inline with `t(error.i18nKey, error.details)`. Each message says **what happened and what to do** (Q10). Network errors offer Retry |
| `409 STALE_VERSION` | Don't overwrite. Show "This record was changed by {name} just now" with **Reload** and **Review my changes** (diff of the user's unsaved fields against the fresh record). Never auto-merge silently (Q4) |
| `409 LEAD_STATE_CHANGED` / `ALREADY_CLAIMED` | Refetch the lead. Toast: "Already acknowledged/claimed by {name}" |
| Empty states | Purposeful (e.g. empty recovery queue = success state; one of the ≤ 5 Lottie slots) |
| Failed messages | Bubble stays with a ⚠ marker + reason + **Retry** (I1.7) |
| Masked values | Render `•••` with a lock icon and a tooltip "You don't have permission to see values". Never `0` or blank |

## 4. Countdown ring (F3.4, F5.6, Q8)

- Input: `ackWindowEndsAt` (server ISO) plus a **server-time offset** computed once per session from the `Date` response header / `serverNow` field (`offset = serverNow − clientNow`, smoothed). Remaining time = `endsAt − (Date.now() + offset)`.
- Renders a ring **plus numeric `mm:ss`** text (color is never the only signal). States: normal → warning (≤ 33% left) → overdue (≤ 0, pulsing, and the text changes to "Overdue +mm:ss"). With `prefers-reduced-motion`, there's no pulse; a static icon is used instead.
- `aria-label` = "Acknowledge within 1 minute 20 seconds". The live region announces only state changes (warning/overdue), not every tick.
- At 0, call `POST /api/v1/tick-nudge` (debounced, once per lead) so escalation happens promptly even if the QStash wake is late. The UI waits for the realtime hint and never changes the owner locally.
- Time-warp active → a badge "⏩ 60×" next to every countdown and in the app shell.

## 5. Internationalization (F7.1, F7.4, F7.7, Q16)

- **Library:** `next-intl` with the `[locale]` segment. Locales: `en`, `ur`. The default comes from the user's profile `users.locale`, then the workspace `default_locale`, then `Accept-Language`. Switching locale updates the profile and navigates to the same path under the new prefix.
- **Messages:** `apps/web/messages/en.json`, `ur.json`, namespaced by area: `common`, `nav`, `auth`, `lead`, `lead.state`, `routing.trace`, `recovery`, `crm`, `inbox`, `ai`, `payments`, `calendar`, `settings.*`, `audit`, `judge`, `errors` (one key per `AppError.code`), `integrations.limits`. Keys are `camelCase`, and values use ICU (`{count, plural, …}`).
- **No hard-coded strings:** ESLint `i18next/no-literal-string` (or `eslint-plugin-react/jsx-no-literals`) runs in error mode on `apps/web/{app,components,features}`. A CI script checks that `en.json` and `ur.json` have identical key sets.
- Server-produced text shown to users (routing trace sentences, banners, Slack alerts, errors) is rendered from **keys + params** in the recipient's locale. The DB stores codes, not prose.
- **Formatting:** `lib/format.ts` wraps `Intl.DateTimeFormat`, `NumberFormat` and `RelativeTimeFormat` with locale `ur-PK` or `en-PK` and the user's timezone. Money: `formatMoney(minor, currency)` with correct minor units, and PKR supported alongside the Stripe test currency. Never use `toLocaleString()` without explicit args, and never concatenate a date manually. Urdu shows Latin digits by default (configurable via `-u-nu-arabext` later; record the choice in `docs/design/`).
- **Customer-facing text** (WhatsApp templates: AI disclosure, fallback reply, payment link, booking confirmation, "has joined") comes from `message_templates` per `en` | `ur` | `ur-Latn`, rendered server-side (F7.5, F7.6). Not in `messages/*.json`.
- **Third language (F7.7):** add `messages/<loc>.json`, register the locale in `i18n/config.ts` (a data list, not code branches), and seed templates. **No component code changes.** A test asserts the locale list is data-driven.

## 6. Right-to-left (F7.2, Q7, Q16)

- `<html lang={locale} dir={locale==='ur' ? 'rtl' : 'ltr'}>` is set in the root layout from the locale config (`dir` is a property of the locale entry).
- **Logical properties only.** Use Tailwind `ms-/me-/ps-/pe-/start-/end-/text-start/text-end/border-s/border-e/rounded-s/rounded-e`. **Lint-ban** `ml-/mr-/pl-/pr-/left-/right-/text-left/text-right/border-l/border-r/rounded-l/rounded-r` (custom ESLint rule or `eslint-plugin-tailwindcss` with a classname blocklist). Raw CSS uses `margin-inline-start`, `inset-inline-end`, etc.
- **Directional icons** (chevrons, arrows, "send", back/next) use an `<Icon flipInRtl />` prop (`rtl:-scale-x-100`). Non-directional icons (check, clock, $) never flip.
- **LTR islands:** phone numbers, emails, amounts, IDs, code, URLs and `mm:ss` timers are wrapped in `<bdi>` or `<span dir="ltr">` via `<Ltr>` helper. Mixed-direction user content (customer messages) uses `dir="auto"` on the bubble.
- Drag-and-drop board, carousels and sliders must respect direction (in RTL the first column is on the right). Framer Motion `x` offsets are multiplied by `dir === 'rtl' ? -1 : 1`.
- Playwright takes screenshots of every primary screen in both `en` and `ur` at phone and laptop widths (`08-testing.md`).

### Urdu typography (F7.3)
- Font **Noto Nastaliq Urdu** via `next/font/google`. It's applied with `:lang(ur)` so Latin text inside Urdu UI keeps the Latin font. Body line-height for Urdu ≥ **1.9–2.2** (Nastaliq has tall ascenders/descenders). No fixed-height containers or `line-clamp` that could clip glyphs. Test truncation on cards. Final sizes/weights come from `docs/design/`.
- Customer messages in Urdu script render with the Nastaliq font even in the English UI (`lang="ur"` on the bubble when the detected language is `ur`).

## 7. Accessibility (Q8)

- Every interactive element is reachable and operable by keyboard with a visible focus ring. Use semantic elements (`button`, `a`, `label`), not clickable `div`s.
- All form inputs have `<label>`, and errors are linked with `aria-describedby`.
- Color never carries meaning alone: countdown text, state chips with icons + text, delivery status icons with `aria-label`.
- Contrast targets WCAG AA. The final palette comes from the design, and a token contrast check runs in CI once tokens land.
- Toasts use `role="status"` (polite); critical errors use `role="alert"`. Modals trap focus and close on Esc.
- The drag-and-drop board has a keyboard alternative ("Move to stage…" menu, shortcut `M`).
- `lang`/`dir` are correct on `<html>` and on mixed-language islands.
- Automated: `@axe-core/playwright` runs on primary screens in both locales and fails CI on serious/critical violations.

## 8. Responsiveness and PWA (Q7)

- Phone-first for the **acknowledge flow**: notification → lead detail → Acknowledge must work one-handed at 360 px width. The Acknowledge button is in thumb reach and sticky at the bottom on mobile.
- No horizontal page scroll at 360 / 768 / 1280 px in LTR or RTL. Tables collapse into cards on phones. The board scrolls horizontally *inside* its container only.
- **PWA:** `app/manifest.ts` (name, icons, `start_url: /{locale}/leads`, `display: standalone`, `dir`/`lang` per locale), a minimal service worker (app-shell caching; never cache `/api/*`) and an install prompt on `/me`. Web Push is optional (P2). Slack is the guaranteed external channel.

## 9. Keyboard shortcuts and command bar (Q17, F9.4, F2.10)

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + K` | Command bar (navigate, search; P2: natural-language filters → editable chips, voice command) |
| `A` | Acknowledge current lead |
| `J` / `K` | Next / previous record (lists, "Work this list") |
| `M` | Move stage (opens stage menu) |
| `R` | Reply (focus composer) |
| `G` then `D`/`L`/`I`/`R` | Go to Dashboard / Leads / Inbox / Radar |
| `?` | Shortcut help screen |

Shortcuts are disabled while typing in inputs. They're defined in one registry (`lib/shortcuts.ts`) that feeds the help screen, so the list is never out of date. Command bar actions are generated from the same nav config (permission-filtered).

## 10. Motion, sound and theming (Q17)

- **Motion budget:** layout animations on the board (`layout` prop), number tickers on dashboard figures, the radar escalation "move" animation, and **≤ 5 Lottie** files in total (payment received, integration connected, empty recovery queue, AI onboarding loader, + 1 spare). Lottie is lazy-loaded. Everything respects `prefers-reduced-motion` (static fallback).
- **Sound cues** (new lead, escalation, payment): off by default on first visit, toggled in `/me` and in the shell, and stored in user prefs. They are never the only signal.
- **Themes:** light/dark via semantic tokens on `:root` / `[data-theme="dark"]`, following `prefers-color-scheme` by default, with a user override stored in prefs. Token names and values: `docs/design/tokens.md` (light + dark).
- **User UI preferences** (dashboard figure visibility F5.5, theme, sound, radar layout) persist server-side in `users.ui_prefs`, so they follow the user across devices.

# Self-Check List: Hisaab

**Team:** Hisaab · **Live app:** https://relay-eta-silk.vercel.app · **Checked:** 2026-10-18, against production

Items are ticked [x] only if we verified them on production today. The run was `pnpm exec tsx scripts/verify-selfcheck.ts`, which uses a real browser and real HTTP. Its raw output is in `reports/selfcheck/results.json`, and the phone screenshots are in `reports/selfcheck/`. Everything else is left unticked on purpose.

## 1. Roles, permissions and security
- [x] The owner can invite users and change roles and permissions in the interface
- [x] Opportunity value is hidden without permission, including through the API
- [x] An unauthorized API call is rejected, and one workspace cannot see another

## 2. Customizable CRM
- [x] Custom fields created from the interface appear immediately
- [x] Two pipelines have different fields, and stages can be added, renamed and reordered
- [x] A stage blocks a move until its required fields are filled
- [x] A saved list updates automatically, and each contact shows its full history

## 3. Lead assignment and escalation
- [ ] Leads come in from the web form, an incoming message and manual entry (web form and manual entry verified; incoming WhatsApp not verified today)
- [x] Only Available employees get leads, and a countdown is visible
- [x] An expired lead escalates once, through levels and times you can configure
- [x] On leave or Offline reassigns immediately, and the recovery queue shows why

## 4. Audit log and dashboard
- [x] Key actions are logged with who, when, and before/after values, and entries cannot be edited
- [x] Dashboard figures are live, match the records and differ by role

## 5. Messaging (WhatsApp)
- [ ] A real message arrives, the reply is delivered and the status updates (needs a human with a phone)
- [ ] Duplicate and forged webhooks are handled, and failed sends can be retried (tested locally, not on production today)

## 6. Payments (Stripe)
- [ ] A test payment updates the record automatically (no paid payment in the current production data)
- [ ] Webhooks are verified and counted once, and refunds and failures show

## 7. Calendar (Google)
- [ ] Google sign-in works, and appointments appear in the real calendar (needs a human to complete OAuth)
- [ ] Clashes are detected, a revoked connection is detected, and time zones are correct

## 8. Notifications (Slack)
- [x] An escalation sends a real alert with a working link (Slack messages delivered; a human should click the link)

## 9. Quality
- [ ] Secrets stay out of the code and the browser, and one provider failing does not break the platform (not re-verified today)
- [ ] Every screen works on a phone and with a keyboard (/leads, /contacts and /me overflow at 375px)
- [ ] Actions show loading, success and clear error messages (error and success verified; loading not checked)
- [ ] Data survives a restart, and timers keep working (not re-verified today)
- [ ] A new person can start the app from the instructions

## 10. Demo
- [ ] The live demo runs, and I tested every ticked item today

## Known limitations

| What does not fully work | What works instead |
|---|---|
| WhatsApp messages **outside the 24-hour window** need Meta-approved templates (submitted, approval pending) | Inside the window, free-text replies work both ways; outside it the send fails visibly with Retry (never silently) |
| WhatsApp test number can only message **registered test recipients** (Meta sandbox rule) | Any registered phone can message in and get replies; forged/duplicate webhooks are rejected/ignored (Judge Console) |
| Older **payment history** on the dashboard chart is seeded demo data | The live Stripe flow (test mode) is real: pay a link with card 4242 → the record turns Paid automatically; refunds/failures update via signed webhooks |
| **Google Calendar** is in Google "Testing" mode: only listed test users can connect, and tokens expire after ~7 days | Connected accounts book real events (visible in Google Calendar), clashes are checked against free/busy, a revoked token shows "Reconnect" |
| **Slack alerts** reach only employees who linked their Slack account | Unlinked employees still get the in-app alert; the skipped Slack alert is recorded with the reason, visible to admins |
| AI stand-in hands off (no AI answer) when a customer asks for a human, is angry, or asks for discounts/prices not in the knowledge base | A polite localized holding message is sent and the human owner is alerted; AI never acknowledges or owns a lead |
| Optional extras not built: first-to-claim pond, skills-based routing, idle re-trigger, event replay | Round-robin assignment with capacity, fallback custody and the full escalation chain work |
| Keyboard-only use is checked on the main flows only | Every page works on a phone; dialogs, menus and forms are keyboard reachable on the main flows |

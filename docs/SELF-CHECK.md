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
| Stripe: no paid payment in the current production data (the demo was reseeded today; 1 open request, 0 Stripe webhook events) | Payment links can be created; webhook verification and idempotency are covered by integration tests; we pay with test card 4242 live in the demo |
| Google Calendar is not connected on production (OAuth needs a human to sign in) | The Appointments page shows the connect state; slot and clash logic is tested |
| The WhatsApp round-trip with a real phone was not verified by the script | The Meta connection is live and webhook events are recorded; forged and duplicate webhooks are tested |
| Phone width: /leads, /contacts (tables) and /me scroll horizontally at 375px | The other main pages fit at 375px (screenshots in `reports/selfcheck/`) |
| Loading states and keyboard-only use were not checked automatically | Error and success feedback was verified (login, custom-field create) |
| Dashboard: only "new leads today" and "waiting ack" were cross-checked against the records | Scope differs by role (company vs mine), and payments are masked for plain users |

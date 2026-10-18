# WhatsApp message templates to submit in Meta

> Source of truth in code: `packages/core/src/integrations/meta/templates.ts` (`WA_TEMPLATES`). Names, languages and
> bodies below must match it exactly; a template Meta has not approved makes the send fail with `template_invalid`
> (visible in the thread, with Retry). Verified 2026-10-18 against Meta's message-templates docs: names are lowercase
> letters/digits/underscores, the same name may exist per language, positional `{{n}}` need example values, three
> categories (authentication, marketing, utility). The "no leading/trailing variable" rule is Meta review practice
> (not stated on that page), so the bodies avoid it.
> Related: I1.10 (24 h window), I2.1 (payment link), I3.9 (booking confirmation).

## Where to submit

Meta Business Suite > WhatsApp Manager > **Message templates** > **Create template** (WABA = the one in `META_WABA_ID`).
For each row: Category **Utility**, Name as given, Language as given, Body as given, no header/footer/buttons, and
fill the sample values from the "Sample values" column (Meta requires examples for every `{{n}}`).
Approval normally takes minutes. Names are lowercase with underscores only. The same name may be submitted in
several languages (that is how `booking_confirmation` en + ur work).

Roman Urdu (Urdu in Latin letters) has no Meta language code, so it is its own template with the suffix `_roman`
in language **English (en)**.

## When Relay uses them

Free text is sent while the customer's last inbound message is less than 24 h old. After that only an approved template
can be sent. Relay picks the language from the contact's language (`en`, `ur`, `ur-Latn`; default `en`):

| Trigger | Inside 24 h | Outside 24 h |
|---|---|---|
| Appointment created for a contact with a phone (I3.9) | same text as free text | `booking_confirmation` |
| "$" button / Send payment link (I2.1) | link text as free text | `payment_link` |
| Follow-up from the composer template picker (I1.10) | free text | `follow_up` |

The composer's template picker lists all of them (keys `booking_confirmation`, `booking_confirmation.ur`,
`booking_confirmation.ur-Latn`, ...). Workspaces may override a body or name with a `message_templates` row of the same key.

## 1. `booking_confirmation` (Utility)

Variables: `{{1}}` customer name, `{{2}}` appointment title, `{{3}}` date and time (Pakistan time).
Sample values: `Ayesha`, `Site visit`, `Mon, 20 Oct, 3:30 pm GMT+5`.

| Language | Meta name | Body |
|---|---|---|
| English (`en`) | `booking_confirmation` | `Hi {{1}}, your appointment "{{2}}" is confirmed for {{3}}. Reply here if you need to change it.` |
| Urdu (`ur`) | `booking_confirmation` | `{{1}}، آپ کی ملاقات "{{2}}" {{3}} کے لیے طے ہو گئی ہے۔ تبدیلی کے لیے یہیں جواب دیں۔` |
| Roman Urdu (submit as `en`) | `booking_confirmation_roman` | `Salam {{1}}, aap ki appointment "{{2}}" {{3}} ke liye confirm ho gayi hai. Tabdeeli ke liye yahin reply karein.` |

## 2. `payment_link` (Utility)

Variables: `{{1}}` customer name, `{{2}}` amount, `{{3}}` what it is for, `{{4}}` secure Stripe Checkout link.
Sample values: `Ayesha`, `PKR 50,000`, `Solar installation advance`, `https://checkout.stripe.com/c/pay/cs_test_a1B2c3`.

| Language | Meta name | Body |
|---|---|---|
| English (`en`) | `payment_link` | `Hi {{1}}, here is your secure payment link for {{2}} ({{3}}): {{4}} Reply here if you have any question.` |
| Urdu (`ur`) | `payment_link` | `{{1}}، {{2}} ({{3}}) کی ادائیگی کے لیے آپ کا محفوظ لنک یہ ہے: {{4}} کوئی سوال ہو تو یہیں جواب دیں۔` |
| Roman Urdu (submit as `en`) | `payment_link_roman` | `Salam {{1}}, {{2}} ({{3}}) ki adaigi ka secure link yeh hai: {{4}} Koi sawal ho to yahin reply karein.` |

## 3. `follow_up` (Utility; if Meta recategorizes it to Marketing, accept it)

Variables: `{{1}}` customer name, `{{2}}` business name. Sample values: `Ayesha`, `Sunrise Solar`.

| Language | Meta name | Body |
|---|---|---|
| English (`en`) | `follow_up` | `Hi {{1}}, this is {{2}} following up on your enquiry. Reply here and we will help you right away.` |
| Urdu (`ur`) | `follow_up` | `{{1}}، یہ {{2}} ہے، آپ کی دریافت کے سلسلے میں رابطہ ہے۔ یہیں جواب دیں، ہم فوراً مدد کریں گے۔` |
| Roman Urdu (submit as `en`) | `follow_up_roman` | `Salam {{1}}, yeh {{2}} hai, aap ki enquiry ke silsile mein rabta hai. Yahin reply karein, hum foran madad karenge.` |

## Notes

- Meta rejects bodies that start or end with a variable, or have two variables back to back; the bodies above avoid both.
  If Meta still rejects one, change the wording in Meta **and** in `templates.ts` together, then re-run the tests.
- While the WABA is in test mode, only numbers on the recipient list can receive messages (`recipient_not_allowed`).
- `hello_world` (shipped with every test number) stays available as a smoke test in the composer.

# ADR-0007: Meta WhatsApp Cloud API for messaging; Telegram for notifications

- **Status:** Partially superseded by ADR-0011 (Telegram part). The WhatsApp/Meta decision stands.
- **Date:** 2026-10-18
- **Requirements touched:** C1, C4, I1, I4

## Context
Twilio isn't required, per the team's report of organizer guidance about availability in Pakistan. The PDF allows Slack, Telegram or email for I4.

## Decision
- Messaging: the Meta WhatsApp Cloud API test number, behind the `MessagingProvider` interface. Twilio and Vonage are optional future adapters.
- Notifications: a Telegram bot with per-user deep-link linking and an inline Acknowledge button (P1).

## Consequences
- Only registered test recipients can receive WhatsApp messages. Judges' numbers must be added beforehand (demo checklist).
- The 24-hour service window and template approval must be handled (I1.10).

## Alternatives considered
- Twilio sandbox: join-phrase friction and expiring joins; availability concerns.
- Email for I4: slower to notice, and no interactive acknowledgement.

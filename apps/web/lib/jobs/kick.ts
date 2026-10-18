// after() kick helper (01 §5 step 5). Owner: Lane A (T-008).
// Call `kickDueWork()` from a route handler / server action AFTER a service committed new due work
// (outbox rows, a deadline): Next runs the tick once the response is sent, so a Slack alert or a
// QStash wake goes out within milliseconds instead of waiting for the next wake-up.
//
//   const lead = await leadsService.create(actor, body);   // commits outbox rows
//   kickDueWork();
//   return lead;
//
// Safe to call many times: the core kicker coalesces overlapping runs in this instance, and
// Postgres (SKIP LOCKED + fencing) makes concurrent runs across instances harmless.
import { kicker, type KickTrigger } from '@relay/core/jobs/kick';
import { after } from 'next/server';

export function kickDueWork(trigger: KickTrigger = 'after'): void {
  const run = () => kicker.kick(trigger);
  try {
    after(run);
  } catch {
    // Outside a request scope (scripts, tests): run in the background instead.
    void run();
  }
}

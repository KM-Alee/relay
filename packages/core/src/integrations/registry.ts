// Adapter registry (04 §1): maps provider → adapter. Tests and the Judge Console swap fakes in here;
// INTEGRATIONS_FAKE=1 selects them (refused in production by config.testing). Owner: Lane C.
import { config } from '../config';
import { createSlackAdapter } from './slack/adapter';
import { createFakeSlack, type FakeSlack } from './slack/fake';
import type { Notifier } from './types';

let override: Notifier | null = null;
let fake: FakeSlack | null = null;

export function setNotifier(n: Notifier | null): void {
  override = n;
}

/** The process-wide fake (tests read `.posted` / `.updated`). */
export function getFakeSlack(): FakeSlack {
  return (fake ??= createFakeSlack());
}

export function getNotifier(): Notifier {
  if (override) return override;
  if (config.testing.INTEGRATIONS_FAKE) return getFakeSlack();
  return realSlack;
}

const realSlack = createSlackAdapter();

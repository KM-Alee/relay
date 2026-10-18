// In-process kick coalescer for after() kicks and nudges (01 §5 step 5). Owner: Lane A (T-008).
// Not a timer and not a correctness mechanism: it only avoids running N overlapping ticks in ONE
// function instance when N requests finish at once. While a run is in flight, further kicks set a
// "rerun" flag and share the in-flight promise; the run then loops once more, so rows committed
// during the first run are still picked up promptly. Cross-instance safety is Postgres's job
// (SKIP LOCKED + fencing), so a duplicate run elsewhere is harmless.
import { config } from '../config';
import { log } from '../log';
import { runDueWork, type RunDueWorkOptions, type TickResult } from './run-due-work';

/** after()/nudge runs are short: they only flush what this request just made due. */
export const KICK_BUDGET_CAP_MS = 10_000;

export type KickTrigger = 'after' | 'nudge';

export interface Kicker {
  kick(trigger?: KickTrigger): Promise<void>;
  /** Number of runs started so far (tests). */
  readonly runs: number;
}

export function createKicker(
  run: (opts: RunDueWorkOptions) => Promise<TickResult> = runDueWork,
  budgetMs: () => number = () => Math.min(config.jobs.TICK_BUDGET_MS, KICK_BUDGET_CAP_MS),
): Kicker {
  let inFlight: Promise<void> | null = null;
  let rerun: KickTrigger | null = null;
  let runs = 0;

  async function loop(first: KickTrigger): Promise<void> {
    let trigger: KickTrigger | null = first;
    while (trigger) {
      rerun = null;
      runs += 1;
      try {
        await run({ trigger, budgetMs: budgetMs() });
      } catch (err) {
        log.error('jobs.kick_failed', { trigger, err });
      }
      trigger = rerun;
    }
  }

  return {
    get runs() {
      return runs;
    },
    kick(trigger = 'after') {
      if (inFlight) {
        rerun = rerun === 'nudge' ? 'nudge' : trigger;
        return inFlight;
      }
      inFlight = loop(trigger).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}

/** Process-wide kicker used by apps/web/lib/jobs/kick.ts. */
export const kicker: Kicker = createKicker();

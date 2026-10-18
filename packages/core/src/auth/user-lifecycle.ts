// User lifecycle hook registry (F1.8, T-105). Owner: Lane B; other lanes REGISTER handlers, never edit
// the deactivation service.
//
//   // Lane A (T-127), at module load of its service:
//   onUserDeactivated(async (tx, { workspaceId, userId, actor }) => { /* transfer live leads */ });
//
// Handlers run INSIDE the deactivation transaction (so a failure rolls the deactivation back: a user is
// never deactivated while still owning leads), after `is_active=false` and session revocation, in
// registration order. Guards run BEFORE the change and veto it by throwing an AppError (e.g. the
// configured fallback owner cannot be deactivated until a replacement is set, F1.8).
import type { Tx } from '@relay/db';
import type { Actor } from './actor';

export interface UserLifecycleContext {
  workspaceId: string;
  /** The user being deactivated / who joined. */
  userId: string;
  /** Who performs the action (the invited person for joins). */
  actor: Actor;
}

export type UserLifecycleHandler = (tx: Tx, ctx: UserLifecycleContext) => Promise<void>;

const deactivated: UserLifecycleHandler[] = [];
const deactivationGuards: UserLifecycleHandler[] = [];
const joined: UserLifecycleHandler[] = [];

const register = (list: UserLifecycleHandler[], h: UserLifecycleHandler) => {
  list.push(h);
  return () => {
    const i = list.indexOf(h);
    if (i >= 0) list.splice(i, 1);
  };
};

/** Transfer accountability etc. Runs in the deactivation tx. Returns an unregister function. */
export const onUserDeactivated = (h: UserLifecycleHandler) => register(deactivated, h);
/** Veto a deactivation by throwing (AppError BUSINESS_RULE_VIOLATION). Runs before the change. */
export const guardUserDeactivation = (h: UserLifecycleHandler) => register(deactivationGuards, h);
/** After an invite is accepted (e.g. add the user to the default team). Runs in the accept tx. */
export const onUserJoined = (h: UserLifecycleHandler) => register(joined, h);

const run = async (list: UserLifecycleHandler[], tx: Tx, ctx: UserLifecycleContext) => {
  for (const h of [...list]) await h(tx, ctx);
};
export const runDeactivationGuards = (tx: Tx, ctx: UserLifecycleContext) => run(deactivationGuards, tx, ctx);
export const runUserDeactivatedHooks = (tx: Tx, ctx: UserLifecycleContext) => run(deactivated, tx, ctx);
export const runUserJoinedHooks = (tx: Tx, ctx: UserLifecycleContext) => run(joined, tx, ctx);

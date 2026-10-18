// Draft model for the policy editor (client state). Levels carry a stable `uid` for keys/animation only.
import type { LevelTarget, PolicyDto, PolicyLevelInput } from '@relay/contracts/api/automations';

export interface DraftLevel {
  uid: string;
  targetType: LevelTarget;
  targetUserId: string | null;
  timeoutSeconds: number;
}

export interface Draft {
  repeatCount: number;
  levels: DraftLevel[];
}

export const MAX_LEVELS = 8;
let seq = 0;
export const nextUid = () => `lv-${++seq}`;

export function draftOf(p: PolicyDto): Draft {
  return {
    repeatCount: p.repeatCount,
    levels: p.levels.map((l) => ({
      uid: nextUid(),
      targetType: l.targetType,
      targetUserId: l.targetUserId,
      timeoutSeconds: l.timeoutSeconds,
    })),
  };
}

export const toInput = (d: Draft): PolicyLevelInput[] =>
  d.levels.map((l) => ({
    targetType: l.targetType,
    targetUserId: l.targetType === 'user' ? l.targetUserId : null,
    timeoutSeconds: l.timeoutSeconds,
  }));

const fingerprint = (d: Draft) =>
  JSON.stringify({
    r: d.repeatCount,
    l: d.levels.map((l) => [l.targetType, l.targetType === 'user' ? l.targetUserId : null, l.timeoutSeconds]),
  });

export const isDirty = (a: Draft, b: Draft) => fingerprint(a) !== fingerprint(b);

export function validate(d: Draft): { level: number; field: 'timeout' | 'user' }[] {
  const errs: { level: number; field: 'timeout' | 'user' }[] = [];
  d.levels.forEach((l, i) => {
    if (!(l.timeoutSeconds >= 1)) errs.push({ level: i, field: 'timeout' });
    if (l.targetType === 'user' && !l.targetUserId) errs.push({ level: i, field: 'user' });
  });
  return errs;
}

/** Total configured time before the lead is flagged critical, for one pass of the chain. */
export const chainSeconds = (d: Draft) => d.levels.reduce((s, l) => s + l.timeoutSeconds, 0) * d.repeatCount;

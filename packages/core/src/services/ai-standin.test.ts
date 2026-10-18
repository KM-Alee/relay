import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { standInDelaySeconds } from './ai-standin';

describe('AI stand-in trigger (F6.2)', () => {
  const s = { mode: 'unacked' as const, waitSeconds: 20, aiEnabled: true };
  const pending = { custody: 'handler' as const, ackStatus: 'pending' as const };

  it('[F6.2] after N s unacked; at once when nobody is available; never once acknowledged', () => {
    expect(standInDelaySeconds(s, pending, 12)).toBe(20);
    expect(standInDelaySeconds(s, { ...pending, custody: 'fallback' }, 12)).toBe(0);
    expect(standInDelaySeconds(s, { ...pending, ackStatus: 'acknowledged' }, 12)).toBeNull();
    expect(standInDelaySeconds({ ...s, mode: 'off' }, pending, 12)).toBeNull();
    expect(standInDelaySeconds({ ...s, aiEnabled: false }, pending, 12)).toBeNull();
    expect(standInDelaySeconds({ ...s, mode: 'no_handler' }, pending, 12)).toBeNull();
    expect(standInDelaySeconds({ ...s, mode: 'after_hours' }, pending, 22)).toBe(0);
  });

  it('[F6.10] [AGENTS rule 7] the AI glue never imports a lead transition', () => {
    const src = readFileSync(path.join(import.meta.dirname, 'ai-standin.ts'), 'utf8');
    const imports = src.split('\n').filter((l) => /^import|from '/.test(l));
    for (const bad of ['./leads', './lead-engine', './lead-actions', '../domain/leads'])
      expect(imports.some((l) => l.includes(`'${bad}'`))).toBe(false);
  });
});

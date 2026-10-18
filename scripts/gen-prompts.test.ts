import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderPrompts } from './gen-prompts';

describe('[Q15] prompt registry', () => {
  it('[Q15] generated.ts matches the versioned .md prompts (run pnpm ai:prompts)', () => {
    const file = path.resolve(import.meta.dirname, '../packages/core/src/ai/prompts/generated.ts');
    expect(readFileSync(file, 'utf8')).toBe(renderPrompts());
  });
});

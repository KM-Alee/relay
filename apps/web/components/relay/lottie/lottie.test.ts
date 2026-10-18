// [Q17] Lottie budget: <= 5 local files, each < 30 KB, vectors only, every colour token-tagged (themeable).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOTTIE_NAMES, TOKEN_VAR } from './names';

const DIR = join(__dirname, '../../../public/lottie');

function paints(node: unknown, out: { nm?: unknown }[] = []) {
  if (Array.isArray(node)) node.forEach((n) => paints(n, out));
  else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (o.ty === 'fl' || o.ty === 'st') out.push({ nm: o.nm });
    Object.values(o).forEach((v) => paints(v, out));
  }
  return out;
}

describe('[Q17] Lottie budget', () => {
  it('[Q17] ships exactly the registered files, at most 5', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeLessThanOrEqual(5);
    expect(files.map((f) => f.replace('.json', '')).sort()).toEqual([...LOTTIE_NAMES].sort());
  });

  for (const name of LOTTIE_NAMES) {
    it(`[Q17] ${name}.json is small and every fill/stroke maps to a design token`, () => {
      const file = join(DIR, `${name}.json`);
      expect(statSync(file).size).toBeLessThan(30 * 1024);
      const json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      expect(json.assets).toEqual([]);
      const ps = paints(json.layers);
      expect(ps.length).toBeGreaterThan(0);
      for (const p of ps) {
        expect(typeof p.nm === 'string' && p.nm.startsWith('tok:')).toBe(true);
        expect(TOKEN_VAR[(p.nm as string).slice(4)]).toBeDefined();
      }
    });
  }
});

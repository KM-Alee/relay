import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAMESPACES } from './namespaces';
import { LOCALES } from './routing';

const dir = path.resolve(import.meta.dirname, '../../messages');
const read = (locale: string, ns: string) =>
  JSON.parse(readFileSync(path.join(dir, locale, `${ns}.json`), 'utf8')) as Record<string, unknown>;

function keysOf(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? keysOf(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe('i18n messages', () => {
  it('[F7.1] every locale has exactly the declared namespace files', () => {
    for (const locale of LOCALES) {
      const files = readdirSync(path.join(dir, locale)).filter((f) => f.endsWith('.json'));
      expect(files.map((f) => f.replace(/\.json$/, '')).sort()).toEqual([...NAMESPACES].sort());
    }
  });

  it.each([...NAMESPACES])('[F7.1] en and ur have identical keys in "%s"', (ns) => {
    const en = keysOf(read('en', ns)).sort();
    expect(en.length).toBeGreaterThan(0);
    for (const locale of LOCALES) expect(keysOf(read(locale, ns)).sort()).toEqual(en);
  });

  it.each([...NAMESPACES])('[F7.1] no empty strings in "%s"', (ns) => {
    for (const locale of LOCALES) {
      const flat = JSON.stringify(read(locale, ns));
      expect(flat).not.toMatch(/:\s*""/);
    }
  });
});

// [F4.3] No screen or endpoint edits or deletes audit history: enumerate every route file under
// /api/v1/audit and assert the only exported methods are GET (list) and POST on /verify (read-only recompute).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? routeFiles(p) : f === 'route.ts' ? [p] : [];
  });
}

describe('[F4.3] audit has no mutation endpoint', () => {
  const root = import.meta.dirname;
  const files = routeFiles(root).map((f) => path.relative(root, f));

  it('[F4.3] exactly the list and verify routes exist', () => {
    expect([...files].sort()).toEqual(['route.ts', 'verify/route.ts']);
  });

  it.each(files)('[F4.3] %s exports only read methods', (f) => {
    const src = readFileSync(path.join(root, f), 'utf8');
    const methods = [...src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
    expect(methods).toEqual(f === 'verify/route.ts' ? ['POST'] : ['GET']);
  });
});

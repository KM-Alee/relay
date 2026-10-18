// pnpm traceability: test reports -> docs/traceability.md (+ optional POST to TEST_RESULTS_URL).
// Run the tests first so the reports exist:  pnpm test:ci   (writes reports/vitest.json)
//   Playwright (optional): reports/playwright.json (written by playwright.config.ts when CI is set)
// Usage: tsx scripts/traceability.ts [--vitest path] [--playwright path] [--out path] [--strict]
//   --strict: exit 1 when any P0 requirement has no test or a test failed (CI gate, off by default).
// docs/08-testing.md §2, F10.3
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildPayload,
  groupByReq,
  parseRequirements,
  renderMarkdown,
  rowsFromPlaywright,
  rowsFromVitest,
  signResults,
  statusOf,
  type TestRow,
} from './lib/traceability';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : def;
};
const vitestPath = path.resolve(root, opt('vitest', 'reports/vitest.json'));
const playwrightPath = path.resolve(root, opt('playwright', 'reports/playwright.json'));
const outPath = path.resolve(root, opt('out', 'docs/traceability.md'));
const strict = args.includes('--strict');

if (!existsSync(vitestPath)) {
  console.error(`traceability: ${path.relative(root, vitestPath)} not found. Run \`pnpm test:ci\` first.`);
  process.exit(1);
}

const rows: TestRow[] = rowsFromVitest(JSON.parse(readFileSync(vitestPath, 'utf8')), root);
if (existsSync(playwrightPath))
  rows.push(...rowsFromPlaywright(JSON.parse(readFileSync(playwrightPath, 'utf8'))));

const requirements = parseRequirements(readFileSync(path.join(root, 'requirements.md'), 'utf8'));
const ranAt = new Date();
const runId = process.env.GITHUB_RUN_ID ? `gh-${process.env.GITHUB_RUN_ID}` : randomUUID();
const gitSha = process.env.GITHUB_SHA ?? 'local';

writeFileSync(
  outPath,
  renderMarkdown({
    requirements,
    rows,
    ranAt,
    runLabel: process.env.GITHUB_RUN_ID
      ? `CI run ${process.env.GITHUB_RUN_ID} @ ${gitSha.slice(0, 7)}`
      : 'local run',
  }),
);
// Requirement list for /traceability (F10.3), shipped with the app (docs/08 §2 step 3).
writeFileSync(
  path.join(root, 'packages/contracts/src/requirements.generated.json'),
  JSON.stringify(requirements, null, 2) + '\n',
);

const byReq = groupByReq(rows);
const failed = requirements.filter((r) => statusOf(byReq.get(r.id) ?? []) === 'failed');
const p0Untested = requirements.filter((r) => r.priority === 'P0' && !byReq.has(r.id));
console.log(
  `traceability: ${rows.length} tagged results, ${requirements.length} requirements, ` +
    `${failed.length} failing, ${p0Untested.length} P0 untested -> ${path.relative(root, outPath)}`,
);

const url = process.env.TEST_RESULTS_URL;
const secret = process.env.TEST_RESULTS_SECRET;
if (url && secret) {
  const body = JSON.stringify(buildPayload(rows, runId, gitSha, ranAt));
  const ts = String(Math.floor(Date.now() / 1000));
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-relay-timestamp': ts,
        'x-relay-signature': signResults(secret, ts, body),
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    console.log(`traceability: POST test results -> HTTP ${res.status}`);
    if (!res.ok && strict) process.exit(1);
  } catch (err) {
    // Reporting must not turn a green build red unless asked to.
    console.warn(`traceability: could not POST results (${(err as Error).name})`);
    if (strict) process.exit(1);
  }
}

if (strict && (failed.length > 0 || p0Untested.length > 0)) {
  console.error('traceability --strict: failing or untested P0 requirements');
  process.exit(1);
}

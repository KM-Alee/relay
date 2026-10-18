import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildPayload,
  compareIds,
  extractTags,
  parseRequirements,
  renderMarkdown,
  rowsFromPlaywright,
  rowsFromVitest,
  signResults,
  statusOf,
} from './traceability';

const REQ_MD = `
### F3. Lead capture (P0, core)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| F3.1 | Lead **capture** | something |
| F3.8 | Single owner | other |

### F6. AI Stand-in (P1, new)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| F6.1 | Stand-in | x |

| ID | Integration | Provider | Purpose |
|---|---|---|---|
| I1 | Messaging | Meta | index row, not a requirement |

### I2. Payments (Stripe)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| I2.1 | Pay link | base |
| I2.9 | Replay | **P1** extension |

## 6. Quality requirements

| ID | Area | Requirement |
|---|---|---|
| Q5 | Concurrency | no double owner |
| Q15 | AI off | works |
`;

describe('[F10.3] traceability: requirements parsing', () => {
  it('[F10.3] parses F/I/Q rows with priority from the heading, skipping index rows', () => {
    const reqs = parseRequirements(REQ_MD);
    expect(reqs.map((r) => [r.id, r.priority])).toEqual([
      ['F3.1', 'P0'],
      ['F3.8', 'P0'],
      ['F6.1', 'P1'],
      ['I2.1', 'P0'],
      ['I2.9', 'P1'],
      ['Q5', 'P0'],
      ['Q15', 'P1'],
    ]);
    expect(reqs[0]!.title).toBe('Lead capture');
  });

  it('[F10.3] parses the real requirements.md (every F/I/Q id found, no duplicates)', async () => {
    const { readFileSync } = await import('node:fs');
    const md = readFileSync(new URL('../../requirements.md', import.meta.url), 'utf8');
    const reqs = parseRequirements(md);
    const ids = reqs.map((r) => r.id);
    expect(reqs.find((r) => r.id === 'F2.9')?.priority).toBe('P1'); // `F2.9 *(P1)*` annotation
    expect(reqs.find((r) => r.id === 'F2.10')?.priority).toBe('P2');
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['F1.1', 'F3.8', 'I1.2', 'Q5', 'Q18', 'F2.9', 'F2.12']));
    expect(ids.length).toBeGreaterThan(100);
  });
});

describe('[F10.3] traceability: tags and reports', () => {
  it('[F10.3] extracts multiple tags, BASE and INV tags, ignoring look-alikes', () => {
    expect(extractTags('[F3.3][F3.5] x', '[BASE-a] [INV-3] [Q5] [X9] [F] [F3.]')).toEqual([
      'F3.3',
      'F3.5',
      'BASE-a',
      'INV-3',
      'Q5',
    ]);
  });

  it('[F10.3] maps vitest assertions to one row per tag and inherits tags from describe blocks', () => {
    const rows = rowsFromVitest(
      {
        testResults: [
          {
            name: '/repo/packages/core/a.test.ts',
            assertionResults: [
              {
                ancestorTitles: ['[Q1] limiter'],
                title: 'blocks',
                fullName: '[Q1] limiter blocks',
                status: 'passed',
                duration: 3.4,
              },
              {
                ancestorTitles: [],
                title: '[F3.3][F3.5] skipped fall',
                fullName: '[F3.3][F3.5] skipped fall',
                status: 'pending',
                duration: null,
              },
              { ancestorTitles: [], title: 'untagged', fullName: 'untagged', status: 'passed' },
              {
                ancestorTitles: [],
                title: '[F3.8] boom',
                fullName: '[F3.8] boom',
                status: 'failed',
                duration: 9,
              },
            ],
          },
        ],
      },
      '/repo',
    );
    expect(rows.map((r) => [r.req_id, r.status, r.duration_ms, r.file])).toEqual([
      ['Q1', 'passed', 3, 'packages/core/a.test.ts'],
      ['F3.3', 'skipped', 0, 'packages/core/a.test.ts'],
      ['F3.5', 'skipped', 0, 'packages/core/a.test.ts'],
      ['F3.8', 'failed', 9, 'packages/core/a.test.ts'],
    ]);
  });

  it('[F10.3] maps nested playwright suites/specs (expected/unexpected/flaky/skipped)', () => {
    const rows = rowsFromPlaywright({
      suites: [
        {
          title: 'rtl.spec.ts',
          suites: [
            {
              title: '[F7.2] RTL',
              specs: [
                {
                  title: 'lead detail',
                  tests: [{ status: 'expected', results: [{ duration: 100 }, { duration: 20 }] }],
                },
              ],
            },
          ],
          specs: [
            { title: '[Q7] phone width', tests: [{ status: 'unexpected', results: [{ duration: 5 }] }] },
            { title: '[Q8] flaky', tests: [{ status: 'flaky', results: [] }] },
            { title: '[Q10] skipped', tests: [{ status: 'skipped', results: [] }] },
          ],
        },
      ],
    });
    expect(rows.map((r) => [r.req_id, r.status, r.duration_ms])).toEqual([
      ['Q7', 'failed', 5],
      ['Q8', 'passed', 0],
      ['Q10', 'skipped', 0],
      ['F7.2', 'passed', 120],
    ]);
  });
});

describe('[F10.3] traceability: status, rendering, publishing', () => {
  const row = (req_id: string, status: 'passed' | 'failed' | 'skipped') => ({
    req_id,
    test_name: `[${req_id}] t`,
    status,
    duration_ms: 1,
    source: 'vitest' as const,
  });

  it('[F10.3] status rules: failed beats passed; all skipped is skipped; none is untested', () => {
    expect(statusOf([])).toBe('untested');
    expect(statusOf([row('F1.1', 'passed'), row('F1.1', 'failed')])).toBe('failed');
    expect(statusOf([row('F1.1', 'skipped')])).toBe('skipped');
    expect(statusOf([row('F1.1', 'skipped'), row('F1.1', 'passed')])).toBe('passed');
  });

  it('[F10.3] sorts ids numerically (F3.10 after F3.9)', () => {
    expect(['F3.10', 'Q2', 'F3.9', 'F1.1', 'Q11'].sort(compareIds)).toEqual([
      'F1.1',
      'F3.9',
      'F3.10',
      'Q2',
      'Q11',
    ]);
  });

  it('[F10.3] renders a generated-file header, per-requirement status, untested and baseline sections', () => {
    const md = renderMarkdown({
      requirements: parseRequirements(REQ_MD),
      rows: [row('F3.1', 'passed'), row('F3.8', 'failed'), row('BASE-a', 'passed')],
      ranAt: new Date('2026-10-18T10:00:00Z'),
      runLabel: 'local run',
    });
    expect(md).toContain('Do not edit by hand');
    expect(md).toContain('| F3.1 | P0 | Lead capture | passed |');
    expect(md).toContain('| F3.8 | P0 | Single owner | **FAILED** |');
    expect(md).toContain('| F6.1 | P1 | Stand-in | untested |');
    expect(md).toContain('P0 untested: 2 of 4');
    expect(md).toContain('## Baseline checks and invariants');
    expect(md).toContain('| BASE-a | passed | 1 |');
  });

  it('[F10.3] signs the POST body with an HMAC over timestamp.body and builds the payload', () => {
    const payload = buildPayload([row('Q1', 'passed')], 'gh-1', 'abc', new Date('2026-10-18T10:00:00Z'));
    expect(payload).toMatchObject({ run_id: 'gh-1', git_sha: 'abc', source: 'ci' });
    expect(payload.results).toEqual([
      { req_id: 'Q1', test_name: '[Q1] t', status: 'passed', duration_ms: 1 },
    ]);
    const body = JSON.stringify(payload);
    const sig = signResults('s3cret', '1700000000', body);
    expect(sig).toBe('sha256=' + createHmac('sha256', 's3cret').update(`1700000000.${body}`).digest('hex'));
    expect(signResults('other', '1700000000', body)).not.toBe(sig);
  });
});

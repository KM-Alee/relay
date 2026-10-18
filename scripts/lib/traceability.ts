// Pure helpers for scripts/traceability.ts (docs/08-testing.md §2, F10.3). No I/O here: unit-tested.
import { createHmac } from 'node:crypto';

export type TestStatus = 'passed' | 'failed' | 'skipped';

export interface TestRow {
  req_id: string;
  test_name: string;
  status: TestStatus;
  duration_ms: number;
  file?: string;
  source: 'vitest' | 'playwright';
}

export interface Requirement {
  id: string;
  title: string;
  priority: 'P0' | 'P1' | 'P2' | '-';
  section: string;
}

export type ReqStatus = TestStatus | 'untested';

// ── tags ────────────────────────────────────────────────────────────────
/** `[F3.8]`, `[I1.2]`, `[Q5]`, `[BASE-a]`, `[INV-3]` (docs/08 §2). */
export const TAG_RE = /\[((?:F|I|Q)\d+(?:\.\d+)?|BASE-[a-e]|INV-[1-7])\]/g;

export function extractTags(...parts: string[]): string[] {
  const out = new Set<string>();
  for (const p of parts) for (const m of p.matchAll(TAG_RE)) out.add(m[1]!);
  return [...out];
}

// ── requirements.md ─────────────────────────────────────────────────────
function headingPriority(heading: string): Requirement['priority'] | undefined {
  const m = heading.match(/\((P[012])\b/);
  if (m) return m[1] as Requirement['priority'];
  return /\(new\)/i.test(heading) ? 'P1' : undefined;
}

/** Rows `| F1.1 | Title | … |` (F/I with a dot, Q with a number). `| I1 | Messaging |` index rows are skipped. */
export function parseRequirements(md: string): Requirement[] {
  const out: Requirement[] = [];
  const seen = new Set<string>();
  let heading = '';
  let priority: Requirement['priority'] | undefined;
  for (const line of md.split('\n')) {
    const h = line.match(/^###? (.+)$/);
    if (h) {
      heading = h[1]!.trim();
      priority = headingPriority(heading);
      continue;
    }
    const r = line.match(/^\|\s*((?:F|I)\d+\.\d+|Q\d+)(?:\s*\*\(([^)]*)\)\*)?\s*\|\s*([^|]*?)\s*\|(.*)$/);
    if (!r || seen.has(r[1]!)) continue;
    const id = r[1]!;
    seen.add(id);
    let p = priority;
    const annotated = r[2]?.match(/\bP[012]\b/)?.[0] as Requirement['priority'] | undefined;
    if (annotated) p = annotated;
    else if (id.startsWith('Q')) p = Number(id.slice(1)) <= 14 ? 'P0' : 'P1';
    else if (!p) p = /\bP1\b/.test(line) ? 'P1' : 'P0';
    const title = r[3]!.replace(/\*\*/g, '').replace(/\s+/g, ' ');
    out.push({ id, title, priority: p ?? '-', section: heading });
  }
  return out;
}

// ── reports ─────────────────────────────────────────────────────────────
interface VitestAssertion {
  ancestorTitles?: string[];
  title?: string;
  fullName?: string;
  status?: string;
  duration?: number | null;
}
interface VitestReport {
  startTime?: number;
  testResults?: Array<{ name?: string; assertionResults?: VitestAssertion[] }>;
}

function mapVitestStatus(s: string | undefined): TestStatus {
  if (s === 'passed') return 'passed';
  if (s === 'failed') return 'failed';
  return 'skipped'; // pending | skipped | todo | disabled
}

export function rowsFromVitest(report: unknown, cwd = ''): TestRow[] {
  const rep = report as VitestReport;
  const rows: TestRow[] = [];
  for (const file of rep.testResults ?? []) {
    const rel = (file.name ?? '').replace(cwd ? `${cwd}/` : '', '');
    for (const a of file.assertionResults ?? []) {
      const name = a.fullName ?? [...(a.ancestorTitles ?? []), a.title ?? ''].join(' ').trim();
      // Tags are inherited from ancestors (describe blocks) as well as the test title.
      for (const tag of extractTags(...(a.ancestorTitles ?? []), a.title ?? '')) {
        rows.push({
          req_id: tag,
          test_name: name,
          status: mapVitestStatus(a.status),
          duration_ms: Math.round(a.duration ?? 0),
          file: rel,
          source: 'vitest',
        });
      }
    }
  }
  return rows;
}

interface PwSpec {
  title?: string;
  file?: string;
  tests?: Array<{ status?: string; results?: Array<{ status?: string; duration?: number }> }>;
}
interface PwSuite {
  title?: string;
  suites?: PwSuite[];
  specs?: PwSpec[];
}

function mapPlaywrightStatus(s: string | undefined): TestStatus {
  if (s === 'expected' || s === 'passed') return 'passed';
  if (s === 'unexpected' || s === 'failed' || s === 'timedOut' || s === 'interrupted') return 'failed';
  if (s === 'flaky') return 'passed'; // passed on retry
  return 'skipped';
}

export function rowsFromPlaywright(report: unknown): TestRow[] {
  const rows: TestRow[] = [];
  const walk = (suite: PwSuite, ancestors: string[]) => {
    const titles = suite.title ? [...ancestors, suite.title] : ancestors;
    for (const spec of suite.specs ?? []) {
      const name = [...titles, spec.title ?? ''].join(' ').trim();
      for (const t of spec.tests ?? []) {
        const duration = (t.results ?? []).reduce((n, r) => n + (r.duration ?? 0), 0);
        for (const tag of extractTags(...titles, spec.title ?? '')) {
          rows.push({
            req_id: tag,
            test_name: name,
            status: mapPlaywrightStatus(t.status),
            duration_ms: Math.round(duration),
            file: spec.file,
            source: 'playwright',
          });
        }
      }
    }
    for (const child of suite.suites ?? []) walk(child, titles);
  };
  for (const s of (report as { suites?: PwSuite[] }).suites ?? []) walk(s, []);
  return rows;
}

// ── aggregation + rendering ─────────────────────────────────────────────
export function statusOf(rows: readonly TestRow[]): ReqStatus {
  if (rows.length === 0) return 'untested';
  if (rows.some((r) => r.status === 'failed')) return 'failed';
  if (rows.every((r) => r.status === 'skipped')) return 'skipped';
  return 'passed';
}

export function groupByReq(rows: readonly TestRow[]): Map<string, TestRow[]> {
  const m = new Map<string, TestRow[]>();
  for (const r of rows) m.set(r.req_id, [...(m.get(r.req_id) ?? []), r]);
  return m;
}

const idKey = (id: string) => {
  const m = id.match(/^([A-Z]+)(\d+)(?:\.(\d+))?$/);
  return m ? [m[1]!, Number(m[2]), Number(m[3] ?? 0)] : [id, 0, 0];
};
export function compareIds(a: string, b: string): number {
  const [la, na, sa] = idKey(a) as [string, number, number];
  const [lb, nb, sb] = idKey(b) as [string, number, number];
  return la.localeCompare(lb) || na - nb || sa - sb;
}

const ICON: Record<ReqStatus, string> = {
  passed: 'passed',
  failed: '**FAILED**',
  skipped: 'skipped',
  untested: 'untested',
};
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const short = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface RenderInput {
  requirements: readonly Requirement[];
  rows: readonly TestRow[];
  ranAt: Date;
  runLabel: string;
}

export function renderMarkdown({ requirements, rows, ranAt, runLabel }: RenderInput): string {
  const byReq = groupByReq(rows);
  const reqIds = new Set(requirements.map((r) => r.id));
  const statuses = requirements.map((r) => ({ r, tests: byReq.get(r.id) ?? [] }));
  const count = (s: ReqStatus, pri?: string) =>
    statuses.filter((x) => statusOf(x.tests) === s && (!pri || x.r.priority === pri)).length;
  const p0 = requirements.filter((r) => r.priority === 'P0');

  const lines: string[] = [
    '<!-- GENERATED by `pnpm traceability` (scripts/traceability.ts). Do not edit by hand. -->',
    '# Requirement traceability',
    '',
    `Last run: ${ranAt.toISOString()} · ${runLabel}`,
    '',
    `**${requirements.length} requirements** · passed ${count('passed')} · failed ${count('failed')} · skipped ${count('skipped')} · untested ${count('untested')}` +
      ` · **P0 untested: ${count('untested', 'P0')} of ${p0.length}**`,
    '',
    "Tests are tagged by ID in their title, e.g. `it('[F3.8] two timers escalate once', …)` (docs/08-testing.md §2).",
    '',
    '| ID | Pri | Requirement | Status | Tests |',
    '|---|---|---|---|---|',
  ];
  for (const { r, tests } of statuses) {
    const names = [...new Set(tests.map((t) => t.test_name))];
    const cell =
      names.length === 0
        ? ''
        : `${names.length}: ` +
          names
            .slice(0, 3)
            .map((n) => esc(short(n)))
            .join('<br>') +
          (names.length > 3 ? `<br>… +${names.length - 3} more` : '');
    lines.push(
      `| ${r.id} | ${r.priority} | ${esc(short(r.title, 80))} | ${ICON[statusOf(tests)]} | ${cell} |`,
    );
  }

  const extra = [...byReq.keys()].filter((id) => !reqIds.has(id)).sort(compareIds);
  if (extra.length) {
    lines.push('', '## Baseline checks and invariants', '', '| Tag | Status | Tests |', '|---|---|---|');
    for (const id of extra) {
      const tests = byReq.get(id)!;
      lines.push(`| ${id} | ${ICON[statusOf(tests)]} | ${tests.length} |`);
    }
  }
  return lines.join('\n') + '\n';
}

// ── publishing ──────────────────────────────────────────────────────────
export interface ResultsPayload {
  run_id: string;
  git_sha: string;
  source: 'ci';
  ran_at: string;
  results: Array<Pick<TestRow, 'req_id' | 'test_name' | 'status' | 'duration_ms'>>;
}

export function buildPayload(
  rows: readonly TestRow[],
  runId: string,
  gitSha: string,
  ranAt: Date,
): ResultsPayload {
  return {
    run_id: runId,
    git_sha: gitSha,
    source: 'ci',
    ran_at: ranAt.toISOString(),
    results: rows.map(({ req_id, test_name, status, duration_ms }) => ({
      req_id,
      test_name,
      status,
      duration_ms,
    })),
  };
}

/**
 * Request signature for POST /api/internal/test-results (receiver verifies in constant time and rejects
 * timestamps older than 5 min): `x-relay-signature: sha256=<hex>` over `${timestamp}.${rawBody}`.
 */
export function signResults(secret: string, timestamp: string, rawBody: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

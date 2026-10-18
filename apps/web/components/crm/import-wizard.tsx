'use client';
// CSV import wizard (T-226, F2.12): upload -> column mapping (auto-suggested) -> per-row validation report ->
// import with progress. The browser parses the file and sends mapped rows to the server in chunks; the SERVER
// re-validates every row, dedupes by phone/email (update or skip) and writes valid rows without blocking on
// invalid ones. Imported text is untrusted: it is only ever rendered as React text (escaped), and the
// downloadable problem report neutralises spreadsheet formulas.
import type { CustomFieldDto } from '@relay/contracts/api/crm';
import { normalizePhone } from '@relay/contracts/api/crm';
import type { ImportRowResult } from '@relay/contracts/api/crm-extras';
import {
  IMPORT_CHUNK,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  applyMapping,
  mappingHasName,
  parseCsv,
  suggestMapping,
  type ImportRowPayload,
  type MapTarget,
  type ParsedCsv,
} from '@relay/contracts/csv-import';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Download,
  FileSpreadsheet,
  Sparkles,
  UploadCloud,
  Users,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react';
import { StatusBadge } from '@/components/relay/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/components/ui/cn';
import { fieldClass } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { Link } from '@/lib/i18n/navigation';
import { ErrorNote, useFieldLabel, useLoad } from './ui';

type Step = 'upload' | 'map' | 'review' | 'import';
const STEPS: Step[] = ['upload', 'map', 'review', 'import'];

interface ReportRow extends ImportRowResult {
  name: string;
  /** Duplicate of an EARLIER row of the same file (dry run only). */
  inFile?: boolean;
}
type Counts = { create: number; update: number; skip: number; error: number };

const countOf = (rows: ReportRow[]): Counts => {
  const c: Counts = { create: 0, update: 0, skip: 0, error: 0 };
  for (const r of rows) c[r.status]++;
  return c;
};

const SAMPLE =
  'Name,Phone,Email,Company\nAyesha Khan,0300 1234567,ayesha@example.com,Khan Traders\nBilal Ahmed,+92 321 7654321,bilal@example.com,\n';

/** Neutralise spreadsheet formulas in the problem report (Q3). */
const safeCell = (v: string) => {
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportWizard() {
  const t = useTranslations('crm.import');
  const label = useFieldLabel();
  const reduce = useReducedMotion();
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<MapTarget[]>([]);
  const [suggested, setSuggested] = useState<MapTarget[]>([]);
  const [onDuplicate, setOnDuplicate] = useState<'update' | 'skip'>('update');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [report, setReport] = useState<ReportRow[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; phase: 'check' | 'import' } | null>(
    null,
  );
  const [final, setFinal] = useState<ReportRow[] | null>(null);
  const [tab, setTab] = useState<'issues' | 'dups'>('issues');
  const abort = useRef<AbortController | null>(null);
  const batchId = useRef('');

  const fields = useLoad(() => api.crm.fields.list({ entity: 'contact' }), 'fields:contact:import');
  const importable = useMemo(
    () => (fields.data?.items ?? []).filter((f: CustomFieldDto) => f.type !== 'ai'),
    [fields.data],
  );

  const payload: ImportRowPayload[] = useMemo(
    () => (parsed ? applyMapping(parsed.rows, mapping) : []),
    [parsed, mapping],
  );

  const readFile = useCallback(
    async (file: File) => {
      setUploadError(null);
      if (file.size > IMPORT_MAX_BYTES) return setUploadError('tooBig');
      if (!/\.(csv|txt|tsv)$/i.test(file.name) && !/text|csv|excel/i.test(file.type))
        return setUploadError('notCsv');
      const text = await file.text();
      const p = parseCsv(text);
      if (!p.headers.length || p.headers.every((h) => !h)) return setUploadError('empty');
      if (!p.rows.length) return setUploadError('noRows');
      const guess = suggestMapping(p.headers, fields.data?.items.filter((f) => f.type !== 'ai') ?? []);
      setFileName(file.name);
      setParsed(p);
      setMapping(guess);
      setSuggested(guess);
      setReport(null);
      setFinal(null);
      setStep('map');
    },
    [fields.data],
  );

  /** One pass over all rows in chunks (dry run or commit). */
  async function runPass(commit: boolean): Promise<ReportRow[]> {
    abort.current = new AbortController();
    const out: ReportRow[] = [];
    const seen = new Set<string>();
    const total = payload.length;
    setProgress({ done: 0, total, phase: commit ? 'import' : 'check' });
    for (let i = 0; i < total; i += IMPORT_CHUNK) {
      if (abort.current.signal.aborted) break;
      const rows = payload.slice(i, i + IMPORT_CHUNK);
      const res = await api.crm.importChunk({ batchId: batchId.current, commit, onDuplicate, rows });
      res.results.forEach((r, k) => {
        const src = rows[k]!;
        const row: ReportRow = { ...r, name: src.name };
        if (!commit && r.status === 'create') {
          // Duplicates inside the file itself only show up across chunks on the client.
          const keys = [
            normalizePhone(src.phone ?? '') && `p:${normalizePhone(src.phone ?? '')}`,
            src.email && `e:${src.email.toLowerCase().trim()}`,
          ].filter((x): x is string => !!x);
          const hit = keys.find((x) => seen.has(x));
          if (hit) {
            row.status = onDuplicate === 'update' ? 'update' : 'skip';
            row.matchedBy = hit.startsWith('p:') ? 'phone' : 'email';
            row.inFile = true;
          } else keys.forEach((x) => seen.add(x));
        }
        out.push(row);
      });
      setProgress({ done: Math.min(total, i + rows.length), total, phase: commit ? 'import' : 'check' });
    }
    return out;
  }

  async function check() {
    setError(null);
    setStep('review');
    setReport(null);
    batchId.current = crypto.randomUUID();
    try {
      setReport(await runPass(false));
    } catch (e) {
      setError(e);
    } finally {
      setProgress(null);
    }
  }

  async function run() {
    setError(null);
    setStep('import');
    setFinal(null);
    try {
      setFinal(await runPass(true));
    } catch (e) {
      setError(e);
    } finally {
      setProgress(null);
    }
  }

  const reset = () => {
    setStep('upload');
    setParsed(null);
    setReport(null);
    setFinal(null);
    setFileName('');
    setError(null);
  };

  const stepIndex = STEPS.indexOf(step);
  const dupTargets = mapping.filter((m, i) => m !== 'skip' && mapping.indexOf(m) !== i);
  const canContinue = mappingHasName(mapping) && dupTargets.length === 0;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-page text-fg">{t('title')}</h1>
        <p className="text-body text-fg-2">{t('subtitle')}</p>
      </header>

      <nav aria-label={t('stepsLabel')}>
        <ol className="flex items-center gap-2">
          {STEPS.map((s, i) => {
            const state = i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'todo';
            return (
              <li
                key={s}
                className="flex flex-1 items-center gap-2"
                aria-current={state === 'current' ? 'step' : undefined}
              >
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-chip text-meta font-semibold transition-colors',
                    state === 'done' && 'bg-success text-on-success',
                    state === 'current' && 'bg-brand-strong text-on-brand-strong',
                    state === 'todo' && 'bg-surface-muted text-fg-muted',
                  )}
                >
                  {state === 'done' ? <Check aria-hidden className="size-4" /> : i + 1}
                </span>
                <span
                  className={cn(
                    'hidden text-meta sm:inline',
                    state === 'current' ? 'font-semibold text-fg' : 'text-fg-2',
                  )}
                >
                  {t(`steps.${s}`)}
                </span>
                {i < STEPS.length - 1 && (
                  <span aria-hidden className="relative h-0.5 flex-1 overflow-hidden rounded-chip bg-line">
                    <motion.span
                      className="absolute inset-y-0 start-0 bg-brand-strong"
                      initial={false}
                      animate={{ width: i < stepIndex ? '100%' : '0%' }}
                      transition={reduce ? { duration: 0 } : { duration: 0.35, ease: [0.2, 0, 0, 1] }}
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <ErrorNote error={error} />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
        >
          {step === 'upload' && <UploadStep onFile={readFile} error={uploadError} />}

          {step === 'map' && parsed && (
            <Card className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-panel text-fg">{t('map.heading')}</h2>
                  <p className="text-meta text-fg-2">
                    {t('map.intro', { count: parsed.rows.length, file: fileName })}
                  </p>
                </div>
                {parsed.truncated && (
                  <StatusBadge tone="warning">{t('upload.truncated', { max: IMPORT_MAX_ROWS })}</StatusBadge>
                )}
              </div>
              <div className="overflow-x-auto rounded-control border border-line">
                <table className="w-full min-w-[34rem] border-collapse text-body">
                  <thead>
                    <tr className="bg-surface-muted text-meta text-fg-2">
                      <th scope="col" className="px-3 py-2 text-start font-medium">
                        {t('map.column')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-start font-medium">
                        {t('map.examples')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-start font-medium">
                        {t('map.goesTo')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.headers.map((h, c) => {
                      const dup = dupTargets.includes(mapping[c]!);
                      return (
                        <tr key={c} className="border-t border-line align-top">
                          <th scope="row" className="px-3 py-2 text-start font-medium text-fg">
                            {h || t('map.unnamed', { n: c + 1 })}
                          </th>
                          <td className="max-w-[16rem] px-3 py-2 text-meta text-fg-2">
                            <span className="line-clamp-2 break-words">
                              {parsed.rows
                                .slice(0, 3)
                                .map((r) => r[c])
                                .filter(Boolean)
                                .join(' · ') || '—'}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                aria-label={t('map.goesToFor', { column: h || String(c + 1) })}
                                aria-invalid={dup || undefined}
                                className={cn(fieldClass, 'h-10 min-w-44 max-w-xs', dup && 'border-danger')}
                                value={mapping[c]}
                                onChange={(e) =>
                                  setMapping((m) =>
                                    m.map((x, i) => (i === c ? (e.target.value as MapTarget) : x)),
                                  )
                                }
                              >
                                <option value="skip">{t('map.targets.skip')}</option>
                                {(['name', 'phone', 'email', 'company', 'language'] as const).map((k) => (
                                  <option key={k} value={k}>
                                    {t(`map.targets.${k}`)}
                                  </option>
                                ))}
                                {importable.length > 0 && (
                                  <optgroup label={t('map.targets.custom')}>
                                    {importable.map((f) => (
                                      <option key={f.id} value={`field:${f.id}`}>
                                        {label(f)}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                              </select>
                              {mapping[c] !== 'skip' && mapping[c] === suggested[c] && (
                                <span className="inline-flex items-center gap-1 text-meta text-ai">
                                  <Sparkles aria-hidden className="size-3.5" />
                                  {t('map.suggested')}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!mappingHasName(mapping) && (
                <p role="alert" className="flex items-center gap-2 text-meta text-danger">
                  <CircleAlert aria-hidden className="size-4" /> {t('map.nameRequired')}
                </p>
              )}
              {dupTargets.length > 0 && (
                <p role="alert" className="flex items-center gap-2 text-meta text-danger">
                  <CircleAlert aria-hidden className="size-4" /> {t('map.dupTarget')}
                </p>
              )}
              <footer className="flex flex-wrap justify-between gap-2">
                <Button variant="secondary" onClick={reset}>
                  <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" /> {t('back')}
                </Button>
                <Button variant="primary" disabled={!canContinue} onClick={check}>
                  {t('map.next')} <ArrowRight aria-hidden className="size-4 rtl:rotate-180" />
                </Button>
              </footer>
            </Card>
          )}

          {step === 'review' && (
            <ReviewStep
              report={report}
              progress={progress}
              onDuplicate={onDuplicate}
              setOnDuplicate={(v) => {
                setOnDuplicate(v);
                setReport(null);
              }}
              tab={tab}
              setTab={setTab}
              onBack={() => setStep('map')}
              onRecheck={check}
              onImport={run}
              payload={payload}
              parsed={parsed}
            />
          )}

          {step === 'import' && (
            <ImportStep
              final={final}
              progress={progress}
              onStop={() => abort.current?.abort()}
              onAnother={reset}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function UploadStep({ onFile, error }: { onFile: (f: File) => void; error: string | null }) {
  const t = useTranslations('crm.import');
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };
  return (
    <Card className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={cn(
          'flex flex-col items-center gap-3 rounded-card border-2 border-dashed px-6 py-14 text-center transition-colors',
          over ? 'border-brand-strong bg-brand-faint' : 'border-line-strong bg-surface-muted',
        )}
      >
        <span
          aria-hidden
          className="flex size-14 items-center justify-center rounded-card bg-brand-faint text-brand-text"
        >
          <UploadCloud className="size-7" />
        </span>
        <p className="text-panel text-fg">{t('upload.dropTitle')}</p>
        <p className="text-meta text-fg-2">
          {t('upload.dropHint', { mb: IMPORT_MAX_BYTES / 1_000_000, rows: IMPORT_MAX_ROWS })}
        </p>
        <input
          ref={input}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          className="sr-only"
          aria-label={t('upload.choose')}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = '';
          }}
        />
        <Button variant="primary" onClick={() => input.current?.click()}>
          <FileSpreadsheet aria-hidden className="size-4" /> {t('upload.choose')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="flex items-center gap-2 text-meta text-danger">
          <CircleAlert aria-hidden className="size-4" />{' '}
          {t(`upload.errors.${error}`, { mb: IMPORT_MAX_BYTES / 1_000_000 })}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-meta text-fg-2">
        <span>{t('upload.formats')}</span>
        <Button variant="link" onClick={() => download('relay-contacts-sample.csv', SAMPLE)}>
          <Download aria-hidden className="size-4" /> {t('upload.sample')}
        </Button>
      </div>
    </Card>
  );
}

function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const reduce = useReducedMotion();
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div
      className="space-y-2"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
    >
      <div className="h-3 overflow-hidden rounded-chip bg-surface-muted">
        <motion.div
          className="h-full rounded-chip bg-brand-strong"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={reduce ? { duration: 0 } : { duration: 0.3, ease: [0.2, 0, 0, 1] }}
        />
      </div>
      <p className="text-meta tabular-nums text-fg-2">{label}</p>
    </div>
  );
}

function Stat({
  icon,
  tone,
  value,
  caption,
}: {
  icon: React.ReactNode;
  tone: 'success' | 'info' | 'danger' | 'neutral';
  value: number;
  caption: string;
}) {
  const toneCls = {
    success: 'bg-success-surface text-success',
    info: 'bg-info-surface text-info',
    danger: 'bg-danger-surface text-danger',
    neutral: 'bg-neutral-surface text-neutral',
  }[tone];
  return (
    <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-4">
      <span
        aria-hidden
        className={cn('flex size-10 items-center justify-center rounded-control [&_svg]:size-5', toneCls)}
      >
        {icon}
      </span>
      <div>
        <p className="text-kpi tabular-nums text-fg">{value}</p>
        <p className="text-meta text-fg-2">{caption}</p>
      </div>
    </div>
  );
}

function ReviewStep({
  report,
  progress,
  onDuplicate,
  setOnDuplicate,
  tab,
  setTab,
  onBack,
  onRecheck,
  onImport,
  payload,
  parsed,
}: {
  report: ReportRow[] | null;
  progress: { done: number; total: number; phase: string } | null;
  onDuplicate: 'update' | 'skip';
  setOnDuplicate: (v: 'update' | 'skip') => void;
  tab: 'issues' | 'dups';
  setTab: (v: 'issues' | 'dups') => void;
  onBack: () => void;
  onRecheck: () => void;
  onImport: () => void;
  payload: ImportRowPayload[];
  parsed: ParsedCsv | null;
}) {
  const t = useTranslations('crm.import');
  const counts = report ? countOf(report) : null;
  const dups = report?.filter((r) => r.matchedBy) ?? [];
  const issues = report?.filter((r) => r.status === 'error') ?? [];
  const rows = (tab === 'issues' ? issues : dups).slice(0, 200);
  const importable = counts ? counts.create + counts.update : 0;

  function downloadReport() {
    if (!report || !parsed) return;
    const head = ['line', 'name', 'phone', 'email', 'problem'];
    const byLine = new Map(payload.map((p) => [p.line, p]));
    const lines = issues.map((r) => {
      const p = byLine.get(r.line);
      return [
        String(r.line),
        p?.name ?? '',
        p?.phone ?? '',
        p?.email ?? '',
        r.errors.map((e) => `${e.field}: ${e.code}`).join('; '),
      ]
        .map(safeCell)
        .join(',');
    });
    download('relay-import-problems.csv', [head.join(','), ...lines].join('\r\n') + '\r\n');
  }

  return (
    <Card className="space-y-5">
      <div>
        <h2 className="text-panel text-fg">{t('review.heading')}</h2>
        <p className="text-meta text-fg-2">{t('review.intro')}</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-meta font-medium text-fg">{t('review.dupLegend')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['update', 'skip'] as const).map((v) => (
            <label
              key={v}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-control border p-3 transition-colors',
                onDuplicate === v
                  ? 'border-brand-strong bg-brand-faint'
                  : 'border-line hover:bg-surface-muted',
              )}
            >
              <input
                type="radio"
                name="dup"
                className="mt-1 accent-[var(--brand-strong)]"
                checked={onDuplicate === v}
                onChange={() => {
                  setOnDuplicate(v);
                }}
              />
              <span>
                <span className="block text-body font-medium text-fg">{t(`review.dup.${v}`)}</span>
                <span className="block text-meta text-fg-2">{t(`review.dup.${v}Hint`)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {!report ? (
        <div className="space-y-3">
          {progress ? (
            <ProgressBar
              done={progress.done}
              total={progress.total}
              label={t('review.checking', { done: progress.done, total: progress.total })}
            />
          ) : (
            <Button variant="primary" onClick={onRecheck}>
              {t('review.check')}
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat icon={<Users />} tone="success" value={counts!.create} caption={t('review.stats.create')} />
            <Stat
              icon={<Check />}
              tone="info"
              value={counts!.update + counts!.skip}
              caption={t('review.stats.dup')}
            />
            <Stat
              icon={<CircleAlert />}
              tone={counts!.error ? 'danger' : 'neutral'}
              value={counts!.error}
              caption={t('review.stats.error')}
            />
          </div>
          <p className="text-meta text-fg-2">{t('review.okNote')}</p>

          {report.length > 0 && (
            <div className="space-y-3">
              <div role="tablist" aria-label={t('review.tabs')} className="flex gap-2">
                {(['issues', 'dups'] as const).map((k) => (
                  <button
                    key={k}
                    role="tab"
                    type="button"
                    aria-selected={tab === k}
                    onClick={() => setTab(k)}
                    className={cn(
                      'h-9 rounded-chip px-4 text-button transition-colors',
                      tab === k
                        ? 'bg-brand-strong text-on-brand-strong'
                        : 'bg-surface-muted text-fg hover:bg-line',
                    )}
                  >
                    {t(`review.tab.${k}`, { count: k === 'issues' ? issues.length : dups.length })}
                  </button>
                ))}
                {issues.length > 0 && (
                  <Button variant="ghost" size="sm" className="ms-auto" onClick={downloadReport}>
                    <Download aria-hidden className="size-4" /> {t('review.downloadReport')}
                  </Button>
                )}
              </div>
              {rows.length === 0 ? (
                <p className="flex items-center gap-2 rounded-control bg-success-surface p-3 text-body text-success">
                  <Check aria-hidden className="size-4" />{' '}
                  {t(tab === 'issues' ? 'review.noIssues' : 'review.noDups')}
                </p>
              ) : (
                <div className="max-h-96 overflow-auto rounded-control border border-line">
                  <table className="w-full min-w-[32rem] border-collapse text-body">
                    <thead className="sticky top-0 bg-surface-muted text-meta text-fg-2">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-start font-medium">
                          {t('review.col.line')}
                        </th>
                        <th scope="col" className="px-3 py-2 text-start font-medium">
                          {t('review.col.name')}
                        </th>
                        <th scope="col" className="px-3 py-2 text-start font-medium">
                          {t(tab === 'issues' ? 'review.col.problem' : 'review.col.result')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.line} className="border-t border-line align-top">
                          <td className="px-3 py-2 tabular-nums text-fg-2">{r.line}</td>
                          <td className="max-w-[14rem] break-words px-3 py-2 text-fg">{r.name || '—'}</td>
                          <td className="px-3 py-2">
                            {tab === 'issues' ? (
                              <ul className="space-y-1">
                                {r.errors.map((e, i) => (
                                  <li key={i}>
                                    <StatusBadge tone="danger">
                                      {t(`errors.${e.code}`)}
                                      {e.field !== 'row' && e.code !== 'unknown_field' ? ` · ${e.field}` : ''}
                                    </StatusBadge>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <StatusBadge tone={r.status === 'update' ? 'info' : 'neutral'}>
                                {t(`review.result.${r.status === 'update' ? 'update' : 'skip'}`, {
                                  by: t(`review.by.${r.matchedBy}`),
                                })}
                                {r.inFile ? ` · ${t('review.inFile')}` : ''}
                              </StatusBadge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(tab === 'issues' ? issues : dups).length > 200 && (
                <p className="text-meta text-fg-muted">{t('review.showingFirst', { count: 200 })}</p>
              )}
            </div>
          )}
        </>
      )}

      <footer className="flex flex-wrap justify-between gap-2">
        <Button variant="secondary" onClick={onBack}>
          <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" /> {t('back')}
        </Button>
        {report ? (
          <Button variant="primary" disabled={importable === 0} onClick={onImport}>
            {t('review.import', { count: importable })}{' '}
            <ArrowRight aria-hidden className="size-4 rtl:rotate-180" />
          </Button>
        ) : null}
      </footer>
    </Card>
  );
}

function ImportStep({
  final,
  progress,
  onStop,
  onAnother,
}: {
  final: ReportRow[] | null;
  progress: { done: number; total: number } | null;
  onStop: () => void;
  onAnother: () => void;
}) {
  const t = useTranslations('crm.import');
  const reduce = useReducedMotion();
  if (!final)
    return (
      <Card className="space-y-4">
        <h2 className="text-panel text-fg">{t('run.importing')}</h2>
        <ProgressBar
          done={progress?.done ?? 0}
          total={progress?.total ?? 1}
          label={t('run.progress', { done: progress?.done ?? 0, total: progress?.total ?? 0 })}
        />
        <Button variant="secondary" onClick={onStop}>
          {t('run.stop')}
        </Button>
      </Card>
    );
  const c = countOf(final);
  return (
    <Card className="flex flex-col items-center gap-4 py-10 text-center">
      <motion.span
        aria-hidden
        initial={reduce ? false : { scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
        className="flex size-16 items-center justify-center rounded-chip bg-success-surface text-success"
      >
        <Check className="size-8" />
      </motion.span>
      <h2 className="text-page text-fg">{t('run.doneTitle')}</h2>
      <p className="text-body text-fg-2" role="status">
        {t('run.doneBody', { created: c.create, updated: c.update, skipped: c.skip, failed: c.error })}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild variant="primary">
          <Link href="/contacts">{t('run.view')}</Link>
        </Button>
        <Button variant="secondary" onClick={onAnother}>
          {t('run.another')}
        </Button>
      </div>
    </Card>
  );
}

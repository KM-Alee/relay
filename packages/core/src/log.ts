// Redacting structured logger (docs/06-security.md §5). Never log secrets, tokens, cookies or
// provider signatures: values under sensitive keys are replaced with "[redacted]" at any depth.
// Usage: `log.error('tick failed', { jobId, err })`. Errors are reduced to name + message.

type Level = 'debug' | 'info' | 'warn' | 'error';

const SENSITIVE_KEY =
  /authorization|cookie|token|secret|password|passwd|api[-_]?key|signature|x-hub-signature|x-slack-signature|stripe-signature|x-slack-request-timestamp|session|sid$|csrf|private[-_]?key|encryption[-_]?key/i;

const MAX_DEPTH = 6;

export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[truncated]';
  seen.add(value);
  if (value instanceof Headers) {
    const out: Record<string, string> = {};
    value.forEach((v, k) => (out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : v));
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1, seen);
  }
  return out;
}

function emit(level: Level, msg: string, meta?: Record<string, unknown>): void {
  const line = { level, msg, time: new Date().toISOString(), ...(meta ? (redact(meta) as object) : {}) };
  const out = JSON.stringify(line);
  if (level === 'error') console.error(out);
  else if (level === 'warn') console.warn(out);
  else console.log(out);
}

export const log = {
  debug: (msg: string, meta?: Record<string, unknown>) => {
    if (process.env.NODE_ENV === 'development') emit('debug', msg, meta);
  },
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta),
};

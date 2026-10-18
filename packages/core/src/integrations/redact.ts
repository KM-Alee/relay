// Redaction for stored webhook summaries and error texts (04 §2, I5.3). PURE.
// Rules: drop anything under secret-ish keys; keep only the last 4 digits of phone numbers; mask emails;
// truncate long strings (message bodies > 500 chars). The full body is kept only as a hash.
import { createHash } from 'node:crypto';

const SECRET_KEY = /(secret|token|key|authorization|password|signature|response_url)/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /\+?\d[\d\s-]{7,}\d/g;
// Slack tokens / generic bearer-ish secrets that might appear inside free text or error strings.
const TOKENISH = /\b(xox[a-z]-[A-Za-z0-9-]+|sk_(?:test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+)\b/g;

export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');

export function redactText(s: string, max = 500): string {
  const out = s
    .replace(TOKENISH, '[redacted]')
    .replace(EMAIL, '[email]')
    .replace(PHONE, (m) => `***${m.replace(/\D/g, '').slice(-4)}`);
  return out.length > max ? out.slice(0, max) + '…' : out;
}

export function redactPayload(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return redactText(value);
  if (typeof value !== 'object') return value;
  if (depth >= 5) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redactPayload(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value))
    out[k] = SECRET_KEY.test(k) ? '[redacted]' : redactPayload(v, depth + 1);
  return out;
}

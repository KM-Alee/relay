// Block Kit alert builder (I4.1, I4.2, F3.9). Pure: no I/O, `now` passed in. Rendered in the
// RECIPIENT's locale. Value is shown only when `showValue` (F1.4, crm.opportunity.value.view).
import { createHmac, timingSafeEqual } from 'node:crypto';

export type SlackLocale = 'en' | 'ur';
export type AlertPurpose = 'assigned' | 'escalated' | 'critical' | 'fallback';

export interface AlertContent {
  leadId: string;
  leadName: string;
  source: string;
  purpose: AlertPurpose;
  /** Trace sentence: why the lead is with you (03 §routing trace). */
  reason: string;
  /** Escalation level (1-based) when purpose = escalated. */
  level?: number;
  /** Acknowledge deadline; null = none. */
  deadlineAt: Date | null;
  /** Pre-formatted value (e.g. "PKR 1,200,000"), or null. Caller applies core/auth/mask.ts. */
  valueText: string | null;
  baseUrl: string;
  locale: SlackLocale;
  alertId: string;
}

const T = {
  en: {
    assigned: 'New lead assigned to you',
    escalated: (l?: number) => `Lead escalated to you${l ? ` (level ${l})` : ''}`,
    critical: 'Critical lead needs you now',
    fallback: 'Lead in your custody (nobody was available)',
    source: 'Source',
    why: 'Why you',
    left: 'Time left',
    overdue: 'Overdue',
    min: (m: number) => `${m} min`,
    value: 'Value',
    open: 'Open lead',
    ack: 'Acknowledge',
  },
  ur: {
    assigned: 'نئی لیڈ آپ کو تفویض ہوئی',
    escalated: (l?: number) => `لیڈ آپ تک پہنچی${l ? ` (سطح ${l})` : ''}`,
    critical: 'اہم لیڈ کو ابھی آپ کی ضرورت ہے',
    fallback: 'لیڈ آپ کی تحویل میں ہے (کوئی دستیاب نہیں تھا)',
    source: 'ذریعہ',
    why: 'آپ کیوں',
    left: 'باقی وقت',
    overdue: 'مدت گزر چکی',
    min: (m: number) => `${m} منٹ`,
    value: 'مالیت',
    open: 'لیڈ کھولیں',
    ack: 'تصدیق کریں',
  },
} as const;

/** TEMPORARY stub until core/auth/mask.ts (T-102, Lane B) is on main: callers must pass the viewer's right. */
export function maskValue(valueText: string | null, canView: boolean): string | null {
  return canView ? valueText : null;
}

/** Slack mrkdwn control characters in user text must be escaped (`&`, `<`, `>`). */
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildAlert(c: AlertContent, secret: string, now: Date): { text: string; blocks: unknown[] } {
  const t = T[c.locale];
  const title = c.purpose === 'escalated' ? t.escalated(c.level) : t[c.purpose];
  const fields: Array<{ type: 'mrkdwn'; text: string }> = [
    { type: 'mrkdwn', text: `*${t.source}*\n${esc(c.source)}` },
  ];
  if (c.deadlineAt) {
    const mins = Math.ceil((c.deadlineAt.getTime() - now.getTime()) / 60_000);
    fields.push({ type: 'mrkdwn', text: `*${t.left}*\n${mins > 0 ? t.min(mins) : t.overdue}` });
  }
  if (c.valueText) fields.push({ type: 'mrkdwn', text: `*${t.value}*\n${esc(c.valueText)}` });
  const url = `${c.baseUrl.replace(/\/$/, '')}/${c.locale}/leads/${c.leadId}`;
  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: title.slice(0, 150) } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${esc(c.leadName)}*\n${t.why}: ${esc(c.reason)}` } },
    { type: 'section', fields },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          action_id: 'lead_ack',
          style: 'primary',
          text: { type: 'plain_text', text: t.ack },
          value: signAlertId(c.alertId, secret),
        },
        { type: 'button', action_id: 'open_lead', text: { type: 'plain_text', text: t.open }, url },
      ],
    },
  ];
  return { text: `${title}: ${c.leadName}`, blocks };
}

/** Message shown after the alert was handled (chat.update): drops the button. */
export function buildResolved(text: string): { text: string; blocks: unknown[] } {
  return { text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: esc(text) } }] };
}

// ── signed opaque button value: `<alertId>.<hmac16>` ─────────────────────
const mac = (alertId: string, secret: string) =>
  createHmac('sha256', secret).update(`slack-alert:${alertId}`).digest('base64url').slice(0, 16);

export function signAlertId(alertId: string, secret: string): string {
  return `${alertId}.${mac(alertId, secret)}`;
}

export function verifyAlertValue(value: string, secret: string): string | null {
  const i = value.lastIndexOf('.');
  if (i < 1) return null;
  const id = value.slice(0, i);
  const a = Buffer.from(value.slice(i + 1));
  const b = Buffer.from(mac(id, secret));
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

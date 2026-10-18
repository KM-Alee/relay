// Post-generation guards (docs/05-ai.md §4.5, F6.8). Pure. Run on EVERY AI text before it can reach a
// customer. Hard violations mean the text must not be sent: the caller substitutes a static template.
import { arabicRatio } from './lang';
import type { Lang } from './types';

export type Violation =
  | 'price' // an amount that is not in the pricing/service knowledge
  | 'promise' // discount / booking confirmed / payment link / refund language
  | 'time' // invented times or ETAs
  | 'name' // a person name that is not the allowed handler
  | 'language' // wrong script for the target language
  | 'empty';

export type SoftFix = 'url_stripped' | 'phone_stripped' | 'markup_stripped' | 'truncated';

export interface GuardContext {
  lang: Lang;
  /** Knowledge entries of kind pricing/service; amounts are only allowed if they appear here. */
  priceKnowledge: string[];
  /** All knowledge text (for allowed URLs/phones). */
  allKnowledge: string[];
  /** Handler first names the reply may mention (F6.7). */
  allowedNames: string[];
  allowedPhones?: string[];
  maxLength?: number;
}

export interface GuardResult {
  /** Sanitized text. Only send when `violations` is empty. */
  text: string;
  violations: Violation[];
  fixes: SoftFix[];
}

const DIGITS: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};
export const asciiDigits = (s: string) => s.replace(/[٠-٩۰-۹]/g, (c) => DIGITS[c] ?? c);

// Currency / amount patterns (en, ur script, Roman Urdu).
const CUR = String.raw`(?:rs\.?|pkr|₨|usd|\$|rupees?|rupay|rupaye|روپے|روپیہ|روپیے)`;
const MULT = String.raw`(?:k|m|lakhs?|lacs?|crores?|hazaar|hazar|thousand|million|ہزار|لاکھ|کروڑ)`;
const AMOUNT_RES = [
  new RegExp(String.raw`${CUR}\s*([\d][\d,.]*)\s*(${MULT})?`, 'giu'),
  new RegExp(String.raw`([\d][\d,.]*)\s*(?:${MULT})?\s*${CUR}`, 'giu'),
  new RegExp(String.raw`([\d][\d,.]*)\s*(${MULT})(?![a-z])`, 'giu'),
  new RegExp(
    String.raw`\b(?:ten|twenty|fifty|hundred|thousand|lakh|lac|crore|das|bees|pachas|sau)\b\s+(?:thousand|hazaar|hazar|lakh|lac|crore|rupees?|rupay|sau)`,
    'giu',
  ),
];

function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of asciiDigits(text).matchAll(/\d[\d,]*(?:\.\d+)?/g))
    out.add(m[0].replace(/,/g, '').replace(/\.0+$/, ''));
  return out;
}

function priceViolations(text: string, priceKnowledge: string[]): boolean {
  const norm = asciiDigits(text);
  const allowed = new Set<string>();
  for (const k of priceKnowledge) for (const n of numbersIn(k)) allowed.add(n);
  for (const re of AMOUNT_RES) {
    re.lastIndex = 0;
    for (const m of norm.matchAll(re)) {
      const raw = m[1];
      if (raw === undefined || !/\d/.test(raw)) return true; // spelled-out amount: never in a KB number set
      const n = raw.replace(/,/g, '').replace(/\.0+$/, '').replace(/[.]$/, '');
      if (!allowed.has(n)) return true;
    }
  }
  return false;
}

// Promise language. Short phrases only; false positives degrade to the holding reply (safe side).
const PROMISE_RES: RegExp[] = [
  // English
  /\bdiscounts?\b/i,
  /\d+\s*%\s*off\b/i,
  /\bpromo(?:tion)?\s*code\b/i,
  /\bcoupon\b/i,
  /\bwaive/i,
  /\brefund/i,
  /\bcheaper\b/i,
  /\bspecial (?:price|rate|offer)\b/i,
  /\bbest price\b/i,
  /\bprice match/i,
  /\b(?:booking|appointment|visit|slot|reservation)\b[^.!?]{0,30}\b(?:is |has been |have been |are )?(?:confirmed|booked|scheduled|reserved|fixed)\b/i,
  /\b(?:i(?:'ve| have|'ll| will)?|we(?:'ve| have|'ll| will)?)\s*(?:just\s*)?(?:booked|scheduled|reserved|confirmed|cancel(?:l)?ed|rescheduled)\b/i,
  /\byou(?:'re| are) (?:booked|confirmed|all set)\b/i,
  /\bpayment link\b/i,
  /\bpay (?:here|now|online|via|using)\b/i,
  /\binvoice\b/i,
  /\bhere(?:'s| is) (?:the|your) (?:link|invoice)\b/i,
  /\bguarantee/i,
  // Urdu script
  /رعایت/u,
  /ڈسکاؤنٹ|ڈسکاونٹ|ڈسکائونٹ/u,
  /ریفنڈ/u,
  /پیمنٹ\s*لنک/u,
  /ادائیگی\s*(?:کا|کے)\s*لنک/u,
  /(?:بکنگ|اپوائنٹمنٹ|وقت)[^۔.!?]{0,25}(?:کنفرم|پکی|طے|بک\s*ہو)/u,
  /بک\s*(?:کر\s*دی|کر\s*دیا|ہو\s*گ)/u,
  /سستا|کم\s*قیمت\s*میں|گارنٹی|ضمانت/u,
  // Roman Urdu
  /\bdiscount\b/i,
  /\braiyat\b|\briayat\b|\brehayat\b|\bchhoot\b|\bchoot\b|\bconcession\b/i,
  /\brefund\b|\bpaise?y? wapis\b|\bpaisay wapas\b/i,
  /\b(?:booking|appointment|slot)\b[^.!?]{0,25}\b(?:confirm|pakki|pakka|fix|ho (?:gai|gayi|gaya)|kar di|kar diya|done)\b/i,
  /\bbook (?:kar|ho) (?:di|diya|gai|gayi|gaya)\b/i,
  /\bpayment (?:ka )?link\b/i,
  /\bgarantee\b|\bguarantee\b/i,
  /\bsasta\b|\bsasti\b/i,
];

// Invented ETAs ("within 10 minutes", "10 minute mein"). Echoing a time the customer asked for is fine.
const TIME_RES: RegExp[] = [
  /\b(?:within|in|after)\s+(?:about\s+|around\s+)?\d+\s*(?:min(?:ute)?s?|hours?|hrs?|days?)\b/i,
  /\b\d+\s*(?:minute|minutes|mint|min|ghante|ghanta|ghantay)\b\s*(?:mein|me|main|tak)/i,
  /\d+\s*(?:منٹ|گھنٹ[ےہ]?)\s*(?:میں|تک)/u,
];

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s)]+/gi;
const PHONE_RE = /(?<![\d])(?:\+?\d[\d\s().-]{7,}\d)(?![\d])/g;

const digitsOnly = (s: string) => asciiDigits(s).replace(/\D/g, '');

export function checkReply(raw: string, ctx: GuardContext): GuardResult {
  const violations = new Set<Violation>();
  const fixes = new Set<SoftFix>();
  let text = raw.normalize('NFC');

  // 1. markup, URLs, phones
  const stripped = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#~>]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  if (stripped !== text) fixes.add('markup_stripped');
  text = stripped;

  const kb = ctx.allKnowledge.join('\n');
  text = text.replace(URL_RE, (u) => {
    if (kb.includes(u.replace(/[.,;]+$/, ''))) return u;
    fixes.add('url_stripped');
    return '';
  });
  const okPhones = [...(ctx.allowedPhones ?? []), ...(kb.match(PHONE_RE) ?? [])]
    .map(digitsOnly)
    .filter(Boolean);
  text = text.replace(PHONE_RE, (p) => {
    const d = digitsOnly(p);
    if (okPhones.some((o) => o.endsWith(d.slice(-9)) && d.length >= 9)) return p;
    fixes.add('phone_stripped');
    return '';
  });
  text = text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) violations.add('empty');

  // 2. price guard (amounts must appear in pricing/service knowledge)
  if (priceViolations(text, ctx.priceKnowledge)) violations.add('price');

  // 3. promise guard
  if (PROMISE_RES.some((re) => re.test(text))) violations.add('promise');

  // 4. invented times
  if (TIME_RES.some((re) => re.test(text))) violations.add('time');

  // 5. names: "<Name> from our team / will join / has been notified" must be an allowed handler
  const allowed = new Set(ctx.allowedNames.map((n) => n.toLowerCase()));
  for (const m of text.matchAll(
    /\b([A-Z][a-z]{2,})\b(?=\s+(?:from our team|will (?:join|call|reply|contact|be)|has been notified|is on (?:the|their) way))/g,
  )) {
    if (!allowed.has(m[1]!.toLowerCase())) violations.add('name');
  }

  // 6. language / script
  const ratio = arabicRatio(text);
  if (ctx.lang === 'ur' ? ratio < 0.6 : ratio > 0.1) violations.add('language');

  // 7. length
  const max = ctx.maxLength ?? 600;
  if (text.length > max) {
    const cut = text.slice(0, max);
    const end = Math.max(
      cut.lastIndexOf('. '),
      cut.lastIndexOf('؟'),
      cut.lastIndexOf('۔'),
      cut.lastIndexOf('? '),
      cut.lastIndexOf('!'),
    );
    text = (end > max * 0.5 ? cut.slice(0, end + 1) : cut).trim();
    fixes.add('truncated');
  }

  return { text, violations: [...violations], fixes: [...fixes] };
}

// Code-level backstop for "customer wants a human" (F6.9), independent of the model.
const HUMAN_RES: RegExp[] = [
  /\b(?:talk|speak|connect|chat|transfer)\b[^.!?]{0,25}\b(?:human|real person|person|someone|somebody|agent|representative|manager|staff)\b/i,
  /\b(?:human|real person|live agent|representative|manager)\b/i,
  /\binsa(?:a)?n\s+se\b|\bkisi\s+(?:insan|insaan|bande|banday|banda)\b|\bbanday?\s+se\s+baat\b|\bmanager\s+se\b|\bkoi\s+(?:insan|insaan|banda)\b/i,
  /انسان\s*سے|کسی\s*(?:بندے|انسان|شخص)\s*سے|مینیجر\s*سے|اصل\s*بندے/u,
];
export const asksForHuman = (text: string): boolean => HUMAN_RES.some((re) => re.test(text));

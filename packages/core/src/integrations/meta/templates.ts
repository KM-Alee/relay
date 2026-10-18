// Meta WhatsApp message templates Relay sends outside the 24 h window (I1.10, I3.9, I2.1).
// Pure catalogue: the exact names/bodies are documented in docs/whatsapp-templates.md and must be
// submitted in Meta Business Manager (WhatsApp Manager -> Message templates) for delivery to work.
// Roman Urdu has no Meta language code, so it is its own template (`<name>_roman`, language `en`).
import type { TemplateDto } from '@relay/contracts/api/messaging';

export type TemplateLocale = 'en' | 'ur' | 'ur-Latn';
export type TemplateBase = 'booking_confirmation' | 'payment_link' | 'follow_up';

interface Variant {
  /** Template name as registered at Meta. */
  name: string;
  /** Meta language code. */
  lang: string;
  /** Body with positional {{n}} placeholders; this is also what the customer sees. */
  body: string;
}

export const WA_TEMPLATES: Record<TemplateBase, Record<TemplateLocale, Variant>> = {
  // {{1}} customer name, {{2}} appointment title, {{3}} date and time (Asia/Karachi)
  booking_confirmation: {
    en: {
      name: 'booking_confirmation',
      lang: 'en',
      body: 'Hi {{1}}, your appointment "{{2}}" is confirmed for {{3}}. Reply here if you need to change it.',
    },
    ur: {
      name: 'booking_confirmation',
      lang: 'ur',
      body: '{{1}}، آپ کی ملاقات "{{2}}" {{3}} کے لیے طے ہو گئی ہے۔ تبدیلی کے لیے یہیں جواب دیں۔',
    },
    'ur-Latn': {
      name: 'booking_confirmation_roman',
      lang: 'en',
      body: 'Salam {{1}}, aap ki appointment "{{2}}" {{3}} ke liye confirm ho gayi hai. Tabdeeli ke liye yahin reply karein.',
    },
  },
  // {{1}} customer name, {{2}} amount (e.g. "PKR 50,000"), {{3}} what it is for, {{4}} secure checkout link
  payment_link: {
    en: {
      name: 'payment_link',
      lang: 'en',
      body: 'Hi {{1}}, here is your secure payment link for {{2}} ({{3}}): {{4}} Reply here if you have any question.',
    },
    ur: {
      name: 'payment_link',
      lang: 'ur',
      body: '{{1}}، {{2}} ({{3}}) کی ادائیگی کے لیے آپ کا محفوظ لنک یہ ہے: {{4}} کوئی سوال ہو تو یہیں جواب دیں۔',
    },
    'ur-Latn': {
      name: 'payment_link_roman',
      lang: 'en',
      body: 'Salam {{1}}, {{2}} ({{3}}) ki adaigi ka secure link yeh hai: {{4}} Koi sawal ho to yahin reply karein.',
    },
  },
  // {{1}} customer name, {{2}} business name
  follow_up: {
    en: {
      name: 'follow_up',
      lang: 'en',
      body: 'Hi {{1}}, this is {{2}} following up on your enquiry. Reply here and we will help you right away.',
    },
    ur: {
      name: 'follow_up',
      lang: 'ur',
      body: '{{1}}، یہ {{2}} ہے، آپ کی دریافت کے سلسلے میں رابطہ ہے۔ یہیں جواب دیں، ہم فوراً مدد کریں گے۔',
    },
    'ur-Latn': {
      name: 'follow_up_roman',
      lang: 'en',
      body: 'Salam {{1}}, yeh {{2}} hai, aap ki enquiry ke silsile mein rabta hai. Yahin reply karein, hum foran madad karenge.',
    },
  },
};

/** Catalogue key used in `messages.template_key` / the composer picker: `payment_link`, `payment_link.ur`, … */
export function templateKeyFor(base: TemplateBase, locale: TemplateLocale): string {
  return locale === 'en' ? base : `${base}.${locale}`;
}

/** Customer language (contacts.language) -> template locale; unknown falls back to English. */
export function templateLocaleOf(language: string | null | undefined): TemplateLocale {
  return language === 'ur' || language === 'ur-Latn' ? language : 'en';
}

export const paramCountOf = (body: string) => new Set(body.match(/\{\{\d+\}\}/g) ?? []).size;

/** The catalogue as TemplateDtos (merged into the composer's template list). */
export function builtinTemplateDtos(): TemplateDto[] {
  const out: TemplateDto[] = [];
  for (const base of Object.keys(WA_TEMPLATES) as TemplateBase[]) {
    for (const locale of ['en', 'ur', 'ur-Latn'] as const) {
      const v = WA_TEMPLATES[base][locale];
      out.push({
        key: templateKeyFor(base, locale),
        name: v.name,
        lang: v.lang,
        body: v.body,
        paramCount: paramCountOf(v.body),
      });
    }
  }
  return out;
}

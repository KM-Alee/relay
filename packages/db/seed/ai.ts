// Seed: AI knowledge base + localized message templates + AI settings (T-208, F6.5). Owner: Lane C.
// Idempotent: fixed ids + ON CONFLICT DO NOTHING. `SEED_KB` is plain data, also used by `pnpm ai:eval`.
import { sql } from 'drizzle-orm';
import { SEED_WORKSPACES } from './identity';
import { SEED_KB } from './ai-data';
import type { SeedModule } from './types';

interface SeedTpl {
  key: string;
  locale: 'en' | 'ur' | 'ur-Latn';
  body: string;
}
const TEMPLATES: SeedTpl[] = [
  {
    key: 'follow_up',
    locale: 'en',
    body: 'Hi {{1}}, this is {{2}} from {{3}}. Following up on your enquiry. When is a good time to talk?',
  },
  {
    key: 'follow_up',
    locale: 'ur-Latn',
    body: 'Assalam o alaikum {{1}}, main {{2}} {{3}} se. Aap ki enquiry ke baare mein baat karni thi. Kab baat karna munasib rahega?',
  },
  {
    key: 'follow_up',
    locale: 'ur',
    body: 'السلام علیکم {{1}}، میں {{3}} سے {{2}} بول رہا ہوں۔ آپ کی انکوائری کے سلسلے میں رابطہ کیا ہے۔ بات کرنے کا مناسب وقت کون سا ہے؟',
  },
  {
    key: 'visit_reminder',
    locale: 'en',
    body: 'Hi {{1}}, a reminder of your visit on {{2}} at {{3}}. Reply here if you need to reschedule.',
  },
  {
    key: 'visit_reminder',
    locale: 'ur-Latn',
    body: 'Assalam o alaikum {{1}}, aap ka {{2}} ko {{3}} baje ka visit hai. Waqt tabdeel karna ho to yahan reply karein.',
  },
  {
    key: 'visit_reminder',
    locale: 'ur',
    body: 'السلام علیکم {{1}}، آپ کا وزٹ {{2}} کو {{3}} بجے ہے۔ وقت بدلنا ہو تو یہاں جواب دیں۔',
  },
  {
    key: 'thank_you',
    locale: 'en',
    body: 'Thank you {{1}} for choosing {{2}}. We are here if you need anything.',
  },
  {
    key: 'thank_you',
    locale: 'ur-Latn',
    body: 'Shukriya {{1}}, {{2}} ko chunne ka. Koi bhi zaroorat ho to hum hazir hain.',
  },
  {
    key: 'thank_you',
    locale: 'ur',
    body: 'شکریہ {{1}}، {{2}} کا انتخاب کرنے کے لیے۔ کوئی بھی ضرورت ہو تو ہم حاضر ہیں۔',
  },
];

const uid = (kind: number, ws: number, n: number) =>
  `0192f3a0-0000-7000-8000-${String(kind).padStart(2, '0')}${String(ws).padStart(2, '0')}${String(n).padStart(8, '0')}`;

export const aiSeed: SeedModule = {
  name: 'ai',
  run: async ({ db, log }) => {
    for (const [i, w] of SEED_WORKSPACES.entries()) {
      const kb = i === 0 ? SEED_KB.sunrise : SEED_KB.crescent;
      for (const [n, e] of kb.entries()) {
        await db.execute(sql`insert into ai_knowledge (id, workspace_id, kind, title, body, language)
          values (${uid(30, i, n + 1)}::uuid, ${w.id}::uuid, ${e.kind},${e.title}, ${e.body}, ${e.language})
          on conflict (id) do nothing`);
      }
      for (const [n, t] of TEMPLATES.entries()) {
        await db.execute(sql`insert into message_templates (id, workspace_id, key, locale, body)
          values (${uid(31, i, n + 1)}::uuid, ${w.id}::uuid, ${t.key}, ${t.locale}, ${t.body})
          on conflict (id) do nothing`);
      }
      await db.execute(sql`insert into ai_settings (workspace_id, standin_mode, trigger_unacked_seconds)
        values (${w.id}::uuid, 'unacked', 60) on conflict (workspace_id) do nothing`);
    }
    log(
      `  ai: ${SEED_KB.sunrise.length + SEED_KB.crescent.length} KB entries, ${TEMPLATES.length} templates per workspace`,
    );
  },
};

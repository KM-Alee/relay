// Seed: crm demo data (T-110…T-118). Owner: Lane B. Idempotent: fixed ids + ON CONFLICT DO NOTHING.
// Sunrise Solar: 2 pipelines (different custom-field sets), 10 contacts, 3 companies, 9 opportunities (PKR),
// tags, a saved list, notes. Crescent Realty: 1 pipeline, 5 contacts, 2 companies, 4 opportunities.
import { sql } from 'drizzle-orm';
import { SEED_USERS, SEED_WORKSPACES } from './identity';
import type { SeedModule } from './types';

/** Deterministic uuid: kind(2) + workspace index(2) + n(8) in the last group. */
const sid = (kind: number, ws: number, n: number) =>
  `0192f3a0-0000-7000-8000-${String(kind).padStart(2, '0')}${String(ws).padStart(2, '0')}${String(n).padStart(8, '0')}`;
const K = {
  contact: 10,
  company: 11,
  pipeline: 12,
  stage: 13,
  opp: 14,
  tag: 15,
  field: 16,
  activity: 18,
  list: 17,
} as const;
const U = (email: string) => SEED_USERS.find((u) => u.email === email)!.id;

type Kind = 'open' | 'won' | 'lost';
const label = (en: string, ur: string) => JSON.stringify({ en, ur });
const opt = (value: string, en: string, ur: string) => ({ value, label: { en, ur } });

interface Spec {
  ws: 0 | 1;
  pipelines: { n: number; name: string; isDefault: boolean; stages: [string, Kind][] }[];
  companies: { n: number; name: string; owner: string }[];
  tags: { n: number; name: string }[];
  fields: {
    n: number;
    entity: 'contact' | 'company' | 'opportunity';
    pipeline?: number;
    key: string;
    en: string;
    ur: string;
    type: 'text' | 'number' | 'date' | 'dropdown' | 'checkbox';
    options?: ReturnType<typeof opt>[];
  }[];
  /** [stagePipeline, stageIndex] required: [pipelineN, stageIdx, fieldN][] */
  required: [number, number, number][];
  contacts: {
    n: number;
    name: string;
    phone: string;
    email?: string;
    company?: number;
    owner: string;
    lang: 'en' | 'ur' | 'ur-Latn';
    tags: number[];
    fields?: Record<number, unknown>;
  }[];
  opps: {
    n: number;
    contact: number;
    pipeline: number;
    stage: number;
    title: string;
    value: number | null;
    owner: string;
    tags?: number[];
    fields?: Record<number, unknown>;
  }[];
  notes: { contact: number; by: string; text: string; hoursAgo: number }[];
}

const sunrise: Spec = {
  ws: 0,
  pipelines: [
    {
      n: 1,
      name: 'Residential solar',
      isDefault: true,
      stages: [
        ['New', 'open'],
        ['Site survey', 'open'],
        ['Quote sent', 'open'],
        ['Negotiation', 'open'],
        ['Won', 'won'],
        ['Lost', 'lost'],
      ],
    },
    {
      n: 2,
      name: 'Commercial solar',
      isDefault: false,
      stages: [
        ['New', 'open'],
        ['Proposal', 'open'],
        ['Won', 'won'],
        ['Lost', 'lost'],
      ],
    },
  ],
  companies: [
    { n: 1, name: 'Raza Traders', owner: 'user@sunrise.test' },
    { n: 2, name: 'Greenfield Textiles', owner: 'manager@sunrise.test' },
    { n: 3, name: 'Punjab Agro Mills', owner: 'user2@sunrise.test' },
  ],
  tags: [
    { n: 1, name: 'Solar' },
    { n: 2, name: 'Hot' },
    { n: 3, name: 'Referral' },
    { n: 4, name: 'VIP' },
  ],
  fields: [
    {
      n: 1,
      entity: 'contact',
      key: 'city',
      en: 'City',
      ur: 'شہر',
      type: 'dropdown',
      options: [
        opt('lahore', 'Lahore', 'لاہور'),
        opt('karachi', 'Karachi', 'کراچی'),
        opt('islamabad', 'Islamabad', 'اسلام آباد'),
      ],
    },
    { n: 2, entity: 'contact', key: 'site_address', en: 'Site address', ur: 'سائٹ کا پتہ', type: 'text' },
    {
      n: 3,
      entity: 'opportunity',
      key: 'roof_type',
      en: 'Roof type',
      ur: 'چھت کی قسم',
      type: 'dropdown',
      options: [opt('flat', 'Flat', 'ہموار'), opt('sloped', 'Sloped', 'ڈھلوان')],
    },
    {
      n: 4,
      entity: 'opportunity',
      pipeline: 1,
      key: 'system_size_kw',
      en: 'System size (kW)',
      ur: 'سسٹم کا سائز (کلوواٹ)',
      type: 'number',
    },
    {
      n: 5,
      entity: 'opportunity',
      pipeline: 1,
      key: 'net_metering',
      en: 'Net metering',
      ur: 'نیٹ میٹرنگ',
      type: 'checkbox',
    },
    {
      n: 6,
      entity: 'opportunity',
      pipeline: 2,
      key: 'site_area_sqft',
      en: 'Site area (sq ft)',
      ur: 'رقبہ (مربع فٹ)',
      type: 'number',
    },
    {
      n: 7,
      entity: 'opportunity',
      pipeline: 2,
      key: 'tender_deadline',
      en: 'Tender deadline',
      ur: 'ٹینڈر کی آخری تاریخ',
      type: 'date',
    },
  ],
  required: [
    [1, 2, 4], // Residential › Quote sent needs system size
    [2, 1, 6], // Commercial › Proposal needs site area
  ],
  contacts: [
    {
      n: 1,
      name: 'Ali Raza',
      phone: '+923001234567',
      email: 'ali.raza@example.com',
      company: 1,
      owner: 'user@sunrise.test',
      lang: 'ur-Latn',
      tags: [1, 2],
      fields: { 1: 'lahore', 2: 'Gulberg III, Lahore' },
    },
    {
      n: 2,
      name: 'Sara Khan',
      phone: '+923214567890',
      email: 'sara.khan@example.com',
      owner: 'user@sunrise.test',
      lang: 'en',
      tags: [1],
      fields: { 1: 'islamabad' },
    },
    {
      n: 3,
      name: 'Hamza Sheikh',
      phone: '+923335550101',
      owner: 'user2@sunrise.test',
      lang: 'ur',
      tags: [3],
      fields: { 1: 'karachi' },
    },
    {
      n: 4,
      name: 'Nadia Iqbal',
      phone: '+923451112233',
      email: 'nadia.iqbal@example.com',
      owner: 'user2@sunrise.test',
      lang: 'en',
      tags: [1, 4],
    },
    {
      n: 5,
      name: 'Tariq Mehmood',
      phone: '+923007778899',
      company: 2,
      owner: 'manager@sunrise.test',
      lang: 'ur-Latn',
      tags: [1],
      fields: { 1: 'lahore' },
    },
    {
      n: 6,
      name: 'Farah Anwar',
      phone: '+923124445566',
      email: 'farah@greenfield.example',
      company: 2,
      owner: 'manager@sunrise.test',
      lang: 'en',
      tags: [4],
    },
    {
      n: 7,
      name: 'Kamran Butt',
      phone: '+923018889900',
      company: 3,
      owner: 'user2@sunrise.test',
      lang: 'ur',
      tags: [],
    },
    {
      n: 8,
      name: 'Zainab Hussain',
      phone: '+923456667788',
      email: 'zainab.h@example.com',
      owner: 'user@sunrise.test',
      lang: 'ur-Latn',
      tags: [2, 3],
    },
    { n: 9, name: 'Usman Ghani', phone: '+923219990011', owner: 'admin@sunrise.test', lang: 'en', tags: [] },
    {
      n: 10,
      name: 'Mehwish Ali',
      phone: '+923338881122',
      email: 'mehwish.ali@example.com',
      owner: 'user@sunrise.test',
      lang: 'ur-Latn',
      tags: [1],
    },
  ],
  opps: [
    {
      n: 1,
      contact: 1,
      pipeline: 1,
      stage: 1,
      title: '5 kW rooftop system',
      value: 85_000_000,
      owner: 'user@sunrise.test',
      tags: [2],
      fields: { 3: 'flat', 4: 5 },
    },
    {
      n: 2,
      contact: 2,
      pipeline: 1,
      stage: 2,
      title: '8 kW hybrid system',
      value: 145_000_000,
      owner: 'user@sunrise.test',
      fields: { 3: 'sloped', 4: 8, 5: true },
    },
    {
      n: 3,
      contact: 3,
      pipeline: 1,
      stage: 0,
      title: '3 kW starter kit',
      value: 52_000_000,
      owner: 'user2@sunrise.test',
    },
    {
      n: 4,
      contact: 4,
      pipeline: 1,
      stage: 3,
      title: '10 kW villa system',
      value: 210_000_000,
      owner: 'user2@sunrise.test',
      tags: [4],
      fields: { 4: 10 },
    },
    {
      n: 5,
      contact: 8,
      pipeline: 1,
      stage: 4,
      title: '6 kW rooftop (installed)',
      value: 98_000_000,
      owner: 'user@sunrise.test',
      fields: { 4: 6 },
    },
    {
      n: 6,
      contact: 10,
      pipeline: 1,
      stage: 0,
      title: '4 kW rooftop system',
      value: 68_000_000,
      owner: 'user@sunrise.test',
    },
    {
      n: 7,
      contact: 5,
      pipeline: 2,
      stage: 1,
      title: 'Greenfield factory roof 120 kW',
      value: 1_650_000_000,
      owner: 'manager@sunrise.test',
      fields: { 6: 18000 },
    },
    {
      n: 8,
      contact: 7,
      pipeline: 2,
      stage: 0,
      title: 'Agro mill 60 kW',
      value: 820_000_000,
      owner: 'user2@sunrise.test',
    },
    {
      n: 9,
      contact: 6,
      pipeline: 2,
      stage: 3,
      title: 'Textile unit 200 kW (lost to tender)',
      value: 2_800_000_000,
      owner: 'manager@sunrise.test',
    },
  ],
  notes: [
    {
      contact: 1,
      by: 'user@sunrise.test',
      text: 'Wants a site visit on Saturday. Roof is flat, 3 floors.',
      hoursAgo: 30,
    },
    { contact: 1, by: 'user@sunrise.test', text: 'Sent the 5 kW quote on WhatsApp.', hoursAgo: 4 },
    {
      contact: 4,
      by: 'user2@sunrise.test',
      text: 'Referral from Farah Anwar. Interested in a hybrid battery option.',
      hoursAgo: 52,
    },
    {
      contact: 5,
      by: 'manager@sunrise.test',
      text: 'Factory visit done. Roof area measured at 18,000 sq ft.',
      hoursAgo: 75,
    },
  ],
};

const crescent: Spec = {
  ws: 1,
  pipelines: [
    {
      n: 1,
      name: 'Property sales',
      isDefault: true,
      stages: [
        ['Inquiry', 'open'],
        ['Viewing', 'open'],
        ['Offer', 'open'],
        ['Closed won', 'won'],
        ['Lost', 'lost'],
      ],
    },
  ],
  companies: [
    { n: 1, name: 'Bahria Investors Group', owner: 'owner@crescent.test' },
    { n: 2, name: 'Malik & Sons', owner: 'user@crescent.test' },
  ],
  tags: [
    { n: 1, name: 'Plot' },
    { n: 2, name: 'Apartment' },
    { n: 3, name: 'Investor' },
  ],
  fields: [
    {
      n: 1,
      entity: 'contact',
      key: 'budget_range',
      en: 'Budget range',
      ur: 'بجٹ کی حد',
      type: 'dropdown',
      options: [
        opt('under_1cr', 'Under 1 crore', 'ایک کروڑ سے کم'),
        opt('1_3cr', '1 to 3 crore', 'ایک سے تین کروڑ'),
        opt('over_3cr', 'Over 3 crore', 'تین کروڑ سے زیادہ'),
      ],
    },
    {
      n: 2,
      entity: 'opportunity',
      key: 'property_type',
      en: 'Property type',
      ur: 'جائیداد کی قسم',
      type: 'dropdown',
      options: [
        opt('plot', 'Plot', 'پلاٹ'),
        opt('apartment', 'Apartment', 'اپارٹمنٹ'),
        opt('house', 'House', 'مکان'),
      ],
    },
  ],
  required: [[1, 2, 2]],
  contacts: [
    {
      n: 1,
      name: 'Saad Rehman',
      phone: '+923001110001',
      email: 'saad@example.com',
      company: 1,
      owner: 'owner@crescent.test',
      lang: 'en',
      tags: [3],
      fields: { 1: 'over_3cr' },
    },
    {
      n: 2,
      name: 'Amna Siddiqui',
      phone: '+923001110002',
      owner: 'user@crescent.test',
      lang: 'ur-Latn',
      tags: [2],
      fields: { 1: '1_3cr' },
    },
    {
      n: 3,
      name: 'Waqas Malik',
      phone: '+923001110003',
      company: 2,
      owner: 'user@crescent.test',
      lang: 'ur',
      tags: [1, 3],
    },
    {
      n: 4,
      name: 'Rabia Noor',
      phone: '+923001110004',
      email: 'rabia@example.com',
      owner: 'user@crescent.test',
      lang: 'en',
      tags: [2],
    },
    {
      n: 5,
      name: 'Danish Farooq',
      phone: '+923001110005',
      owner: 'owner@crescent.test',
      lang: 'ur-Latn',
      tags: [],
    },
  ],
  opps: [
    {
      n: 1,
      contact: 1,
      pipeline: 1,
      stage: 2,
      title: '10 marla plot, DHA Phase 6',
      value: 3_500_000_000,
      owner: 'owner@crescent.test',
      tags: [1],
      fields: { 2: 'plot' },
    },
    {
      n: 2,
      contact: 2,
      pipeline: 1,
      stage: 1,
      title: '2-bed apartment, Gulberg',
      value: 1_800_000_000,
      owner: 'user@crescent.test',
      tags: [2],
      fields: { 2: 'apartment' },
    },
    {
      n: 3,
      contact: 3,
      pipeline: 1,
      stage: 0,
      title: '1 kanal plot, Bahria Town',
      value: 2_200_000_000,
      owner: 'user@crescent.test',
    },
    {
      n: 4,
      contact: 4,
      pipeline: 1,
      stage: 3,
      title: '1-bed apartment, Clifton',
      value: 950_000_000,
      owner: 'user@crescent.test',
    },
  ],
  notes: [{ contact: 1, by: 'owner@crescent.test', text: 'Cash buyer. Wants a corner plot.', hoursAgo: 20 }],
};

export const crmSeed: SeedModule = {
  name: 'crm',
  run: async ({ db, log }) => {
    for (const s of [sunrise, crescent]) {
      const ws = SEED_WORKSPACES[s.ws].id;
      const q = (query: ReturnType<typeof sql>) => db.execute(query);
      const stageIds = new Map<string, string>(); // `${pipeline}:${idx}`
      for (const p of s.pipelines) {
        await q(sql`insert into pipelines (id, workspace_id, name, position, is_default)
                    values (${sid(K.pipeline, s.ws, p.n)}::uuid, ${ws}::uuid, ${p.name}, ${p.n - 1}, ${p.isDefault}) on conflict do nothing`);
        for (const [i, [name, kind]] of p.stages.entries()) {
          const id = sid(K.stage, s.ws, p.n * 100 + i);
          stageIds.set(`${p.n}:${i}`, id);
          await q(sql`insert into stages (id, workspace_id, pipeline_id, name, position, kind)
                      values (${id}::uuid, ${ws}::uuid, ${sid(K.pipeline, s.ws, p.n)}::uuid, ${name}, ${i}, ${kind}) on conflict (id) do nothing`);
        }
      }
      for (const c of s.companies)
        await q(sql`insert into companies (id, workspace_id, name, owner_user_id)
                    values (${sid(K.company, s.ws, c.n)}::uuid, ${ws}::uuid, ${c.name}, ${U(c.owner)}::uuid) on conflict do nothing`);
      for (const t of s.tags)
        await q(
          sql`insert into tags (id, workspace_id, name) values (${sid(K.tag, s.ws, t.n)}::uuid, ${ws}::uuid, ${t.name}) on conflict do nothing`,
        );
      for (const f of s.fields)
        await q(sql`insert into custom_fields (id, workspace_id, entity, pipeline_id, key, label, type, options, position)
                    values (${sid(K.field, s.ws, f.n)}::uuid, ${ws}::uuid, ${f.entity},
                            ${f.pipeline ? sid(K.pipeline, s.ws, f.pipeline) : null}::uuid, ${f.key}, ${label(f.en, f.ur)}::jsonb, ${f.type},
                            ${JSON.stringify(f.options ?? [])}::jsonb, ${f.n}) on conflict do nothing`);
      for (const [p, idx, fld] of s.required)
        await q(sql`insert into stage_required_fields (workspace_id, stage_id, field_id)
                    values (${ws}::uuid, ${stageIds.get(`${p}:${idx}`)}::uuid, ${sid(K.field, s.ws, fld)}::uuid) on conflict do nothing`);
      for (const c of s.contacts) {
        const id = sid(K.contact, s.ws, c.n);
        await q(sql`insert into contacts (id, workspace_id, company_id, name, phone_e164, email, owner_user_id, language, last_activity_at, created_at)
                    values (${id}::uuid, ${ws}::uuid, ${c.company ? sid(K.company, s.ws, c.company) : null}::uuid, ${c.name}, ${c.phone},
                            ${c.email ?? null}, ${U(c.owner)}::uuid, ${c.lang}, now() - make_interval(hours => ${c.n * 5}), now() - make_interval(days => ${20 - c.n}))
                    on conflict do nothing`);
        for (const t of c.tags)
          await q(
            sql`insert into contact_tags (workspace_id, tag_id, contact_id) values (${ws}::uuid, ${sid(K.tag, s.ws, t)}::uuid, ${id}::uuid) on conflict do nothing`,
          );
        for (const [fn, v] of Object.entries(c.fields ?? {}))
          await q(sql`insert into field_values (id, workspace_id, field_id, contact_id, value, source)
                      values (${sid(19, s.ws, c.n * 10 + Number(fn))}::uuid, ${ws}::uuid, ${sid(K.field, s.ws, Number(fn))}::uuid, ${id}::uuid, ${JSON.stringify(v)}::jsonb, 'import') on conflict do nothing`);
      }
      for (const o of s.opps) {
        const id = sid(K.opp, s.ws, o.n);
        const stage = stageIds.get(`${o.pipeline}:${o.stage}`)!;
        const closed = s.pipelines.find((p) => p.n === o.pipeline)!.stages[o.stage]![1] !== 'open';
        await q(sql`insert into opportunities (id, workspace_id, contact_id, pipeline_id, stage_id, title, value_minor, currency, owner_user_id, stage_entered_at, closed_at, created_at)
                    values (${id}::uuid, ${ws}::uuid, ${sid(K.contact, s.ws, o.contact)}::uuid, ${sid(K.pipeline, s.ws, o.pipeline)}::uuid, ${stage}::uuid,
                            ${o.title}, ${o.value}, 'PKR', ${U(o.owner)}::uuid, now() - make_interval(days => ${o.n % 6}),
                            ${closed ? sql`now() - make_interval(days => 1)` : null}, now() - make_interval(days => ${12 - o.n}))
                    on conflict do nothing`);
        for (const t of o.tags ?? [])
          await q(
            sql`insert into opportunity_tags (workspace_id, tag_id, opportunity_id) values (${ws}::uuid, ${sid(K.tag, s.ws, t)}::uuid, ${id}::uuid) on conflict do nothing`,
          );
        for (const [fn, v] of Object.entries(o.fields ?? {}))
          await q(sql`insert into field_values (id, workspace_id, field_id, opportunity_id, value, source)
                      values (${sid(19, s.ws, 1000 + o.n * 10 + Number(fn))}::uuid, ${ws}::uuid, ${sid(K.field, s.ws, Number(fn))}::uuid, ${id}::uuid, ${JSON.stringify(v)}::jsonb, 'import') on conflict do nothing`);
      }
      for (const [i, n] of s.notes.entries())
        await q(sql`insert into activities (id, workspace_id, contact_id, type, actor_type, actor_user_id, payload, occurred_at)
                    values (${sid(K.activity, s.ws, i + 1)}::uuid, ${ws}::uuid, ${sid(K.contact, s.ws, n.contact)}::uuid, 'note', 'user', ${U(n.by)}::uuid,
                            ${JSON.stringify({ body: n.text })}::jsonb, now() - make_interval(hours => ${n.hoursAgo})) on conflict do nothing`);
      // A shared saved list per workspace: contacts tagged with the first tag (live membership).
      await q(sql`insert into saved_lists (id, workspace_id, owner_user_id, name, entity, criteria, is_shared)
                  values (${sid(K.list, s.ws, 1)}::uuid, ${ws}::uuid, ${U(s.ws === 0 ? 'owner@sunrise.test' : 'owner@crescent.test')}::uuid,
                          ${s.ws === 0 ? 'Solar leads' : 'Plot buyers'}, 'contact',
                          ${JSON.stringify({ match: 'all', clauses: [{ field: 'tag', op: 'in', value: [sid(K.tag, s.ws, 1)] }] })}::jsonb, true) on conflict do nothing`);
    }
    // Demo: Hina Raza (plain User) may export, so the masked-value export is demonstrable (F2.11, F1.4).
    await db.execute(sql`insert into user_permission_overrides (workspace_id, user_id, permission, effect)
                         values (${SEED_WORKSPACES[0].id}::uuid, ${U('user2@sunrise.test')}::uuid, 'crm.export', 'grant') on conflict do nothing`);
    log(
      `  crm: sunrise ${sunrise.contacts.length} contacts/${sunrise.opps.length} opps, crescent ${crescent.contacts.length}/${crescent.opps.length}`,
    );
  },
};

// CSV contact import (T-226, F2.12). The browser parses the file and sends mapped rows in chunks of <= 200;
// THIS service is the trust boundary: every row is re-validated, deduped by phone / email against existing
// contacts (update or skip), and, on commit, written in a per-row savepoint so one bad row never blocks the
// valid ones. Imported text is untrusted (Q3): control + bidi characters are stripped, React escapes on
// display, and exports neutralise spreadsheet formulas (exports.ts csvCell).
import { normalizePhone, type CrmEntity } from '@relay/contracts/api/crm';
import type { ImportChunkResponse, ImportRowResult } from '@relay/contracts/api/crm-extras';
import type { importChunkInput } from '@relay/contracts/api/crm-extras';
import { withWorkspaceTx, type Tx, type TxOptions } from '@relay/db';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { append as auditAppend } from '../audit/index';
import type { Actor } from '../auth/actor';
import { assertPermission, can } from '../auth/permissions';
import { uuidv7 } from '../ids';
import { emit } from '../realtime/index';
import { recordActivity } from './crm-activity';
import { one, rows, saveFieldValues, scopeSql, type FieldRow } from './crm-shared';

type Input = z.output<typeof importChunkInput>;
type RowIn = Input['rows'][number];
type Lang = 'en' | 'ur' | 'ur-Latn';

/** Strip control chars + bidi overrides (spoofing), collapse whitespace. */
export function cleanText(s: string): string {
  return (
    s
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩‎‏]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

const EMAIL_RE = /^[^\s@<>"',;:()[\]\\]{1,64}@[^\s@<>"',;:()[\]\\]+\.[^\s@<>"',;:()[\]\\.]{2,}$/;

function parseLanguage(raw: string): Lang | null {
  const v = raw.toLowerCase().replace(/[\s_]+/g, '-');
  if (['en', 'english', 'eng'].includes(v)) return 'en';
  if (['ur', 'urdu', 'اردو'].includes(v)) return 'ur';
  if (['ur-latn', 'roman-urdu', 'roman', 'urdu-roman'].includes(v)) return 'ur-Latn';
  return null;
}

const TRUE = new Set(['true', 'yes', 'y', '1', 'ہاں']);
const FALSE = new Set(['false', 'no', 'n', '0', 'نہیں']);

/** Cell text -> a typed custom-field value, or `undefined` when it does not fit the field. */
function toFieldValue(f: FieldRow, raw: string): string | number | boolean | undefined {
  const v = cleanText(raw);
  switch (f.type) {
    case 'number': {
      const n = Number(v.replace(/,/g, ''));
      return v !== '' && Number.isFinite(n) ? n : undefined;
    }
    case 'checkbox':
      return TRUE.has(v.toLowerCase()) ? true : FALSE.has(v.toLowerCase()) ? false : undefined;
    case 'date': {
      let iso = v;
      const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
      if (dmy) iso = `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`;
      return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(Date.parse(iso)) ? iso : undefined;
    }
    case 'dropdown': {
      const o = f.options.find((x) =>
        [x.value, x.label.en, x.label.ur].some((l) => l.toLowerCase() === v.toLowerCase()),
      );
      return o?.value;
    }
    default:
      return v.slice(0, 2000);
  }
}

interface Clean {
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  language: Lang | null;
  fields: Record<string, string | number | boolean>;
}

function validateRow(
  row: RowIn,
  defs: Map<string, FieldRow>,
): { ok: true; row: Clean } | { ok: false; errors: ImportRowResult['errors'] } {
  const errors: ImportRowResult['errors'] = [];
  const name = cleanText(row.name);
  if (!name) errors.push({ field: 'name', code: 'name_required' });
  else if (name.length > 120) errors.push({ field: 'name', code: 'name_too_long' });

  let phone: string | null = null;
  if (row.phone && cleanText(row.phone)) {
    phone = normalizePhone(cleanText(row.phone));
    if (!phone) errors.push({ field: 'phone', code: 'phone_invalid' });
  }
  let email: string | null = null;
  if (row.email && cleanText(row.email)) {
    const e = cleanText(row.email).toLowerCase();
    if (e.length <= 200 && EMAIL_RE.test(e)) email = e;
    else errors.push({ field: 'email', code: 'email_invalid' });
  }
  let company: string | null = null;
  if (row.company && cleanText(row.company)) {
    company = cleanText(row.company);
    if (company.length > 120) errors.push({ field: 'company', code: 'company_too_long' });
  }
  let language: Lang | null = null;
  if (row.language && cleanText(row.language)) {
    language = parseLanguage(cleanText(row.language));
    if (!language) errors.push({ field: 'language', code: 'language_invalid' });
  }
  const fields: Clean['fields'] = {};
  for (const [id, raw] of Object.entries(row.fields)) {
    const def = defs.get(id);
    if (!def) {
      errors.push({ field: id, code: 'unknown_field' });
      continue;
    }
    const v = toFieldValue(def, raw);
    if (v === undefined) errors.push({ field: def.key, code: 'invalid_value' });
    else fields[id] = v;
  }
  return errors.length
    ? { ok: false, errors }
    : { ok: true, row: { name, phone, email, company, language, fields } };
}

interface Existing {
  id: string;
  phone_e164: string | null;
  email: string | null;
}

async function findMatches(
  tx: Tx,
  r: Clean,
): Promise<{ byPhone: Existing | null; byEmail: Existing | null }> {
  const byPhone = r.phone
    ? await one<Existing>(
        tx,
        sql`select id, phone_e164, email from contacts where phone_e164 = ${r.phone} and deleted_at is null`,
      )
    : null;
  const byEmail = r.email
    ? await one<Existing>(
        tx,
        sql`select id, phone_e164, email from contacts where email = ${r.email} and deleted_at is null`,
      )
    : null;
  return { byPhone, byEmail };
}

async function companyIdFor(tx: Tx, actor: Actor, name: string): Promise<string | null> {
  const hit = await one<{ id: string }>(
    tx,
    sql`select id from companies where lower(name) = lower(${name}) and deleted_at is null order by created_at limit 1`,
  );
  if (hit) return hit.id;
  if (!can(actor, 'crm.company.create')) return null;
  const id = uuidv7();
  await tx.execute(
    sql`insert into companies (id, workspace_id, name, owner_user_id)
        values (${id}::uuid, ${actor.workspaceId}::uuid, ${name}, ${actor.userId}::uuid)`,
  );
  return id;
}

export const importService = {
  /**
   * POST /imports/contacts (crm.import + crm.contact.create). `commit: false` is a dry run that reports what
   * WOULD happen per row; `commit: true` writes. Rows never block each other: each commits in a savepoint.
   */
  async chunk(actor: Actor, input: Input, opts: TxOptions = {}): Promise<ImportChunkResponse> {
    assertPermission(actor, 'crm.import');
    assertPermission(actor, 'crm.contact.create');
    if (input.onDuplicate === 'update') assertPermission(actor, 'crm.contact.edit');
    return withWorkspaceTx(
      actor.workspaceId,
      async (tx) => {
        const defRows = await rows<FieldRow>(
          tx,
          sql`select * from custom_fields where entity = 'contact' and type <> 'ai'`,
        );
        const defs = new Map(defRows.map((d) => [d.id, d]));
        const visible = scopeSql(actor, 'contact' satisfies CrmEntity);
        const results: ImportRowResult[] = [];
        const seen = new Map<string, 'phone' | 'email'>(); // dry-run: duplicates inside this chunk

        for (const row of input.rows) {
          const base = { line: row.line, contactId: null, matchedBy: null } as const;
          const v = validateRow(row, defs);
          if (!v.ok) {
            results.push({ ...base, status: 'error', errors: v.errors });
            continue;
          }
          const r = v.row;
          const { byPhone, byEmail } = await findMatches(tx, r);
          if (byPhone && byEmail && byPhone.id !== byEmail.id) {
            results.push({
              ...base,
              status: 'error',
              errors: [{ field: 'phone', code: 'duplicate_conflict' }],
            });
            continue;
          }
          const match = byPhone ?? byEmail;
          const matchedBy = byPhone ? 'phone' : byEmail ? 'email' : null;

          if (!match) {
            const earlier =
              (r.phone && seen.get(`p:${r.phone}`)) || (r.email && seen.get(`e:${r.email}`)) || null;
            if (!input.commit && earlier) {
              results.push({
                ...base,
                matchedBy: earlier,
                status: input.onDuplicate === 'update' ? 'update' : 'skip',
                errors: [],
              });
              continue;
            }
            if (!input.commit) {
              if (r.phone) seen.set(`p:${r.phone}`, 'phone');
              if (r.email) seen.set(`e:${r.email}`, 'email');
              results.push({ ...base, status: 'create', errors: [] });
              continue;
            }
            results.push(await commitCreate(tx, actor, input.batchId, row.line, r));
            continue;
          }

          if (input.onDuplicate === 'skip') {
            results.push({ ...base, contactId: null, matchedBy, status: 'skip', errors: [] });
            continue;
          }
          // Update: only contacts the importer may see (never reveal or touch the rest).
          const allowed = await one(
            tx,
            sql`select c.id from contacts c where c.id = ${match.id}::uuid and ${visible}`,
          );
          if (!allowed) {
            results.push({
              ...base,
              matchedBy,
              status: 'error',
              errors: [{ field: matchedBy ?? 'phone', code: 'duplicate_out_of_scope' }],
            });
            continue;
          }
          if (!input.commit) {
            results.push({ ...base, contactId: match.id, matchedBy, status: 'update', errors: [] });
            continue;
          }
          results.push(await commitUpdate(tx, actor, input.batchId, row.line, r, match, matchedBy));
        }

        const counts = { create: 0, update: 0, skip: 0, error: 0 };
        for (const x of results) counts[x.status]++;
        if (input.commit) {
          await auditAppend(tx, actor, {
            action: 'crm.imported',
            targetType: 'contact',
            targetId: null,
            after: {
              created: counts.create,
              updated: counts.update,
              skipped: counts.skip,
              failed: counts.error,
            },
            meta: {
              batchId: input.batchId,
              onDuplicate: input.onDuplicate,
              lines: [input.rows[0]!.line, input.rows.at(-1)!.line],
            },
          });
          await emit(tx, {
            workspaceId: actor.workspaceId,
            topic: 'contacts',
            ids: results.flatMap((x) => (x.contactId ? [x.contactId] : [])).slice(0, 100),
          });
        }
        return { commit: input.commit, results, counts };
      },
      opts,
    );
  },
};

async function commitCreate(
  tx: Tx,
  actor: Actor,
  batchId: string,
  line: number,
  r: Clean,
): Promise<ImportRowResult> {
  try {
    return await tx.transaction(async (sp) => {
      const s = sp as unknown as Tx;
      const id = uuidv7();
      const companyId = r.company ? await companyIdFor(s, actor, r.company) : null;
      await s.execute(
        sql`insert into contacts (id, workspace_id, company_id, name, phone_e164, email, owner_user_id, language, language_source)
            values (${id}::uuid, ${actor.workspaceId}::uuid, ${companyId}::uuid, ${r.name}, ${r.phone}, ${r.email},
                    ${actor.userId}::uuid, ${r.language}, 'manual')`,
      );
      if (Object.keys(r.fields).length)
        await saveFieldValues(s, actor, 'contact', id, r.fields, { source: 'import' });
      await recordActivity(s, actor, {
        contactId: id,
        type: 'import',
        payload: { batchId, line, action: 'created' },
      });
      return { line, status: 'create' as const, contactId: id, matchedBy: null, errors: [] };
    });
  } catch {
    return {
      line,
      status: 'error',
      contactId: null,
      matchedBy: null,
      errors: [{ field: 'row', code: 'row_failed' }],
    };
  }
}

async function commitUpdate(
  tx: Tx,
  actor: Actor,
  batchId: string,
  line: number,
  r: Clean,
  match: Existing,
  matchedBy: 'phone' | 'email' | null,
): Promise<ImportRowResult> {
  try {
    return await tx.transaction(async (sp) => {
      const s = sp as unknown as Tx;
      await s.execute(sql`select id from contacts where id = ${match.id}::uuid for update`);
      const companyId = r.company ? await companyIdFor(s, actor, r.company) : null;
      // Update = refresh name / company / language / fields; fill phone or email only when currently empty.
      await s.execute(
        sql`update contacts set name = ${r.name},
              company_id = coalesce(${companyId}::uuid, company_id),
              language = coalesce(${r.language}, language),
              phone_e164 = coalesce(phone_e164, ${match.phone_e164 ? null : r.phone}),
              email = coalesce(email, ${match.email ? null : r.email}),
              version = version + 1
            where id = ${match.id}::uuid`,
      );
      if (Object.keys(r.fields).length)
        await saveFieldValues(s, actor, 'contact', match.id, r.fields, { source: 'import' });
      await recordActivity(s, actor, {
        contactId: match.id,
        type: 'import',
        payload: { batchId, line, action: 'updated', matchedBy },
      });
      return { line, status: 'update' as const, contactId: match.id, matchedBy, errors: [] };
    });
  } catch {
    return {
      line,
      status: 'error',
      contactId: match.id,
      matchedBy,
      errors: [{ field: 'row', code: 'row_failed' }],
    };
  }
}

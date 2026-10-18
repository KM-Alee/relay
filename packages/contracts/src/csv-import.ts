// CSV import helpers (T-226, F2.12): a small RFC 4180 parser and the column-mapping auto-suggest. Pure and
// dependency-free so the browser (preview, mapping screen) and the server (tests) share one implementation.
// The server still re-validates EVERY row (Q3): nothing here is a trust boundary.

export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_MAX_BYTES = 2_000_000;
export const IMPORT_CHUNK = 100;

export interface ParsedCsv {
  headers: string[];
  /** Data rows (header excluded); every row has `headers.length` cells. */
  rows: string[][];
  delimiter: ',' | ';' | '\t';
  /** Rows beyond IMPORT_MAX_ROWS were dropped. */
  truncated: boolean;
}

function detectDelimiter(firstLine: string): ',' | ';' | '\t' {
  const count = (d: string) => {
    let n = 0;
    let q = false;
    for (const ch of firstLine) {
      if (ch === '"') q = !q;
      else if (!q && ch === d) n++;
    }
    return n;
  };
  const c = { ',': count(','), ';': count(';'), '\t': count('\t') } as const;
  if (c['\t'] > c[','] && c['\t'] >= c[';']) return '\t';
  return c[';'] > c[','] ? ';' : ',';
}

/** Parse CSV text: quoted cells, escaped quotes, CRLF/LF, BOM, `,` `;` or TAB. Blank lines are skipped. */
export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^﻿/, '');
  const delimiter = detectDelimiter(text.split(/\r?\n/, 1)[0] ?? '');
  const all: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c.trim() !== '')) all.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) endCell();
    else if (ch === '\n') endRow();
    else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else cell += ch;
  }
  if (cell !== '' || row.length) endRow();

  const headers = (all.shift() ?? []).map((h) => h.trim());
  const width = headers.length;
  const truncated = all.length > IMPORT_MAX_ROWS;
  const rows = all.slice(0, IMPORT_MAX_ROWS).map((r) => {
    const cells = r.slice(0, width).map((c) => c.trim());
    while (cells.length < width) cells.push('');
    return cells;
  });
  return { headers, rows, delimiter, truncated };
}

// ── Mapping ─────────────────────────────────────────────────────────────
export type BuiltinTarget = 'name' | 'phone' | 'email' | 'company' | 'language';
/** `skip`, a built-in contact column, or `field:<customFieldId>`. */
export type MapTarget = 'skip' | BuiltinTarget | `field:${string}`;

export interface MappableField {
  id: string;
  key: string;
  label: { en: string; ur: string };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '');

const SYNONYMS: Record<BuiltinTarget, string[]> = {
  name: [
    'name',
    'fullname',
    'contactname',
    'customer',
    'customername',
    'firstname',
    'client',
    'person',
    'نام',
  ],
  phone: [
    'phone',
    'phonenumber',
    'mobile',
    'mobilenumber',
    'cell',
    'cellphone',
    'whatsapp',
    'tel',
    'telephone',
    'contactnumber',
    'number',
    'فون',
    'موبائل',
  ],
  email: ['email', 'emailaddress', 'mail', 'eaddress', 'ایمیل'],
  company: ['company', 'companyname', 'organisation', 'organization', 'org', 'business', 'employer', 'کمپنی'],
  language: ['language', 'lang', 'preferredlanguage', 'زبان'],
};

/** Best guess for each column. A target is suggested at most once; unknown columns are skipped. */
export function suggestMapping(
  headers: readonly string[],
  fields: readonly MappableField[] = [],
): MapTarget[] {
  const used = new Set<string>();
  const take = (t: MapTarget): MapTarget => {
    used.add(t);
    return t;
  };
  const builtins = Object.keys(SYNONYMS) as BuiltinTarget[];
  return headers.map((h) => {
    const n = norm(h);
    if (!n) return 'skip';
    for (const target of builtins) {
      if (!used.has(target) && SYNONYMS[target].some((s) => norm(s) === n)) return take(target);
    }
    for (const f of fields) {
      const t = `field:${f.id}` as const;
      if (!used.has(t) && [f.key, f.label.en, f.label.ur].some((l) => norm(l) === n)) return take(t);
    }
    // Looser pass: the header contains a synonym ("Customer Phone No").
    for (const target of builtins) {
      if (!used.has(target) && SYNONYMS[target].some((s) => s.length > 3 && n.includes(norm(s))))
        return take(target);
    }
    return 'skip';
  });
}

export interface ImportRowPayload {
  line: number;
  name: string;
  phone?: string;
  email?: string;
  company?: string;
  language?: string;
  fields: Record<string, string>;
}

/** Apply a mapping to parsed rows. `line` is the 1-based line number in the file (header = line 1). */
export function applyMapping(rows: readonly string[][], mapping: readonly MapTarget[]): ImportRowPayload[] {
  return rows.map((cells, i) => {
    const out: ImportRowPayload = { line: i + 2, name: '', fields: {} };
    mapping.forEach((t, c) => {
      const v = (cells[c] ?? '').trim();
      if (!v || t === 'skip') return;
      if (t.startsWith('field:')) out.fields[t.slice(6)] = v;
      else out[t as BuiltinTarget] = v;
    });
    return out;
  });
}

/** A mapping is usable when a name column is mapped. */
export const mappingHasName = (m: readonly MapTarget[]) => m.includes('name');

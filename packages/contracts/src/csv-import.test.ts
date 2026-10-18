import { describe, expect, it } from 'vitest';
import { applyMapping, parseCsv, suggestMapping } from './csv-import';

describe('csv import helpers', () => {
  it('[F2.12] parses quotes, escaped quotes, CRLF, BOM and semicolons', () => {
    const p = parseCsv('﻿Name;Phone\r\n"Ali; ""Bhai"" Khan";0300 1234567\r\n\r\nSara;\r\n');
    expect(p.delimiter).toBe(';');
    expect(p.headers).toEqual(['Name', 'Phone']);
    expect(p.rows).toEqual([
      ['Ali; "Bhai" Khan', '0300 1234567'],
      ['Sara', ''],
    ]);
  });

  it('[F2.12] suggests a column mapping from header names (English and Urdu)', () => {
    const fields = [{ id: 'f1', key: 'budget', label: { en: 'Budget (PKR)', ur: 'بجٹ' } }];
    expect(
      suggestMapping(['Full Name', 'Mobile No', 'E-mail', 'Company', 'Budget (PKR)', 'Notes'], fields),
    ).toEqual(['name', 'phone', 'email', 'company', 'field:f1', 'skip']);
    expect(suggestMapping(['نام', 'فون'])).toEqual(['name', 'phone']);
  });

  it('[F2.12] applies a mapping and numbers lines from the file header (line 1)', () => {
    const rows = applyMapping([['Ali', '0300 1234567', 'x']], ['name', 'phone', 'skip']);
    expect(rows).toEqual([{ line: 2, name: 'Ali', phone: '0300 1234567', fields: {} }]);
  });
});

'use client';
// Companies (T-110, F2.1): list, create, rename (with the optimistic-lock conflict message), soft delete.
import type { CompanyDto } from '@relay/contracts/api/crm';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { ExportButton } from './export-button';
import { ErrorNote, has, ui, useLoad, useMe } from './ui';

export function CompaniesView() {
  const t = useTranslations('crm.companies');
  const me = useMe();
  const [q, setQ] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const list = useLoad(() => api.crm.companies.list({ q: q || undefined, limit: 100 }), `companies:${q}`);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await api.crm.companies.create({ name: String(new FormData(form).get('name')) });
      form.reset();
      setError(null);
      list.reload();
    } catch (err) {
      setError(err);
    }
  }
  async function rename(c: CompanyDto) {
    if (!editing) return;
    try {
      await api.crm.companies.update(c.id, { name: editing.name, version: c.version });
      setEditing(null);
      setError(null);
      list.reload();
    } catch (err) {
      setError(err);
      if (err instanceof ApiError && err.code === 'STALE_VERSION') setEditing(null);
      list.reload();
    }
  }
  async function remove(c: CompanyDto) {
    if (!window.confirm(t('confirmDelete', { name: c.name }))) return;
    try {
      await api.crm.companies.delete(c.id);
      list.reload();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="space-y-4">
      <header className={`${ui.row} justify-between`}>
        <h1 className={ui.h1}>{t('title')}</h1>
        <ExportButton entity="company" />
      </header>
      <div className={ui.row}>
        <input
          className={ui.input}
          type="search"
          placeholder={t('search')}
          aria-label={t('search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {has(me, 'crm.company.create') && (
          <form onSubmit={create} className={ui.row}>
            <input name="name" required className={ui.input} placeholder={t('name')} aria-label={t('name')} />
            <button className={ui.btnPrimary}>{t('create')}</button>
          </form>
        )}
      </div>
      <ErrorNote error={error ?? list.error} />
      {list.loading ? (
        <p aria-busy="true">{t('loading')}</p>
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <p className={ui.muted}>{t('empty')}</p>
      ) : (
        <table className={ui.table}>
          <thead>
            <tr>
              {(['name', 'owner', 'contacts'] as const).map((c) => (
                <th key={c} className={ui.th} scope="col">
                  {t(c)}
                </th>
              ))}
              <th className={ui.th} scope="col">
                <span className="sr-only">{t('actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.data?.items.map((c) => (
              <tr key={c.id}>
                <td className={ui.td}>
                  {editing?.id === c.id ? (
                    <input
                      className={ui.input}
                      value={editing.name}
                      aria-label={t('name')}
                      onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                    />
                  ) : (
                    c.name
                  )}
                </td>
                <td className={ui.td}>{c.ownerName ?? t('unassigned')}</td>
                <td className={ui.td}>{c.contactCount}</td>
                <td className={ui.td}>
                  <span className={ui.row}>
                    {has(me, 'crm.company.edit') &&
                      (editing?.id === c.id ? (
                        <button type="button" className={ui.btnPrimary} onClick={() => rename(c)}>
                          {t('save')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={ui.btn}
                          onClick={() => setEditing({ id: c.id, name: c.name })}
                        >
                          {t('rename')}
                        </button>
                      ))}
                    {has(me, 'crm.company.delete') && (
                      <button type="button" className={ui.btnDanger} onClick={() => remove(c)}>
                        {t('delete')}
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

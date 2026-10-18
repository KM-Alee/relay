'use client';
// Contacts list (T-110, T-115, T-118): search + filters + saved lists + create + CSV export.
import type { ContactDto } from '@relay/contracts/api/crm';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api-client';
import { Link } from '@/lib/i18n/navigation';
import { ExportButton } from './export-button';
import { EMPTY_FILTER, FilterBar, filterParam, toCriteria, type FilterState } from './filter-bar';
import { ErrorNote, has, ui, useLoad, useMe } from './ui';

interface Page {
  items: ContactDto[];
  nextCursor: string | null;
  total: number | null;
}

export function ContactsView() {
  const t = useTranslations('crm.contacts');
  const me = useMe();
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [listId, setListId] = useState('');
  const [extra, setExtra] = useState<ContactDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);

  const tags = useLoad(() => api.crm.tags.list(), 'tags');
  const fields = useLoad(() => api.crm.fields.list({ entity: 'contact' }), 'fields');
  const lists = useLoad(() => api.crm.lists.list(), 'lists');
  const fieldItems = fields.data?.items ?? [];
  const criteria = toCriteria(filter, fieldItems, 'contact');
  const filterStr = filterParam(criteria);
  const key = JSON.stringify([filter.q, filterStr, listId]);

  const page = useLoad(
    () =>
      listId
        ? api.crm.lists
            .items(listId, { limit: 50 })
            .then((r): Page => ({ items: r.items as ContactDto[], nextCursor: r.nextCursor, total: r.total }))
        : api.crm.contacts
            .list({ q: filter.q || undefined, filter: filterStr, limit: 50 })
            .then((r): Page => ({ ...r, total: null })),
    key,
  );
  const rows = [...(page.data?.items ?? []), ...extra];
  const next = cursor ?? page.data?.nextCursor ?? null;
  const owners = [
    ...(me ? [{ id: me.user.id, name: me.user.name }] : []),
    ...rows.flatMap((r) => (r.ownerUserId && r.ownerName ? [{ id: r.ownerUserId, name: r.ownerName }] : [])),
  ].filter((o, i, a) => a.findIndex((x) => x.id === o.id) === i);

  async function loadMore() {
    if (!next) return;
    try {
      const r = listId
        ? await api.crm.lists.items(listId, { cursor: next, limit: 50 })
        : await api.crm.contacts.list({
            q: filter.q || undefined,
            filter: filterStr,
            cursor: next,
            limit: 50,
          });
      setExtra((e) => [...e, ...(r.items as ContactDto[])]);
      setCursor(r.nextCursor ?? '');
    } catch (e) {
      setError(e);
    }
  }
  const reset = () => {
    setExtra([]);
    setCursor(null);
  };

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api.crm.contacts.create({
        name: String(f.get('name')),
        phone: String(f.get('phone') ?? '') || undefined,
        email: String(f.get('email') ?? '') || undefined,
      });
      setCreating(false);
      setError(null);
      reset();
      page.reload();
    } catch (err) {
      setError(err);
    }
  }

  async function saveList() {
    const name = window.prompt(t('listNamePrompt'));
    if (!name) return;
    try {
      const l = await api.crm.lists.create({ name, entity: 'contact', criteria, isShared: true });
      lists.reload();
      setListId(l.id);
      reset();
    } catch (err) {
      setError(err);
    }
  }

  const contactLists = (lists.data?.items ?? []).filter((l) => l.entity === 'contact');
  const activeList = contactLists.find((l) => l.id === listId);

  return (
    <div className="space-y-4">
      <header className={`${ui.row} justify-between`}>
        <h1 className={ui.h1}>{t('title')}</h1>
        <div className={ui.row}>
          <ExportButton entity="contact" filter={filterStr} savedListId={listId || undefined} />
          {has(me, 'crm.import') && has(me, 'crm.contact.create') && (
            <Link href="/contacts/import" className={ui.btn}>
              {t('import')}
            </Link>
          )}
          {has(me, 'crm.contact.create') && (
            <button type="button" className={ui.btnPrimary} onClick={() => setCreating((v) => !v)}>
              {t('new')}
            </button>
          )}
        </div>
      </header>

      <div className={ui.row}>
        <label className={ui.muted} htmlFor="saved-list">
          {t('lists')}
        </label>
        <select
          id="saved-list"
          className={ui.input}
          value={listId}
          onChange={(e) => {
            setListId(e.target.value);
            reset();
          }}
        >
          <option value="">{t('allContacts')}</option>
          {contactLists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.needsReview ? ` (${t('needsReview')})` : ''}
            </option>
          ))}
        </select>
        {!listId && criteria.clauses.length > 0 && (
          <button type="button" className={ui.btn} onClick={saveList}>
            {t('saveList')}
          </button>
        )}
        {activeList && (
          <span className={ui.muted}>{t('liveCount', { count: page.data?.total ?? rows.length })}</span>
        )}
      </div>

      {!listId && (
        <FilterBar
          entity="contact"
          value={filter}
          onChange={(s) => {
            setFilter(s);
            reset();
          }}
          tags={tags.data?.items ?? []}
          owners={owners}
          fields={fieldItems}
        />
      )}

      {creating && (
        <form onSubmit={create} className={`${ui.panel} ${ui.row}`}>
          <input name="name" required className={ui.input} placeholder={t('name')} aria-label={t('name')} />
          <input name="phone" className={ui.input} placeholder={t('phone')} aria-label={t('phone')} />
          <input
            name="email"
            type="email"
            className={ui.input}
            placeholder={t('email')}
            aria-label={t('email')}
          />
          <button className={ui.btnPrimary}>{t('create')}</button>
        </form>
      )}

      <ErrorNote error={error ?? page.error} />
      {page.loading ? (
        <p aria-busy="true">{t('loading')}</p>
      ) : rows.length === 0 ? (
        <p className={ui.muted}>{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={ui.table}>
            <thead>
              <tr>
                {(['name', 'phone', 'company', 'owner', 'tags', 'lastActivity'] as const).map((c) => (
                  <th key={c} className={ui.th} scope="col">
                    {t(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className={ui.td}>
                    <Link href={`/contacts/${c.id}`} className="text-[var(--brand-text)] underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className={ui.td} dir="ltr">
                    {c.phoneE164}
                  </td>
                  <td className={ui.td}>{c.companyName}</td>
                  <td className={ui.td}>{c.ownerName ?? t('unassigned')}</td>
                  <td className={ui.td}>
                    <span className={ui.row}>
                      {c.tags.map((x) => (
                        <span key={x.id} className={ui.chip}>
                          {x.name}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className={ui.td}>
                    {c.lastActivityAt ? new Date(c.lastActivityAt).toLocaleDateString() : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next && (
        <button type="button" className={ui.btn} onClick={loadMore}>
          {t('loadMore')}
        </button>
      )}
    </div>
  );
}

'use client';
// Tags settings (T-114, F2.1): create, rename, delete. Deleting removes the tag from every record and
// cleans saved lists that used it (no dangling references).
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api-client';
import { ErrorNote, ui, useLoad } from './ui';

export function SettingsTags() {
  const t = useTranslations('crm.settings.tags');
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const tags = useLoad(() => api.crm.tags.list(), 'tags');

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
      setEditing(null);
    } catch (e) {
      setError(e);
    }
    tags.reload();
  };

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    await run(async () => {
      await api.crm.tags.create(String(new FormData(form).get('name')));
      form.reset();
    });
  }

  return (
    <div className="space-y-4">
      <h1 className={ui.h1}>{t('title')}</h1>
      <p className={ui.muted}>{t('intro')}</p>
      <ErrorNote error={error ?? tags.error} />
      <ul className="space-y-2">
        {tags.data?.items.map((x) => (
          <li key={x.id} className={`${ui.card} ${ui.row}`}>
            {editing?.id === x.id ? (
              <>
                <input
                  className={ui.input}
                  value={editing.name}
                  aria-label={t('name')}
                  onChange={(e) => setEditing({ id: x.id, name: e.target.value })}
                />
                <button
                  type="button"
                  className={ui.btnPrimary}
                  onClick={() => run(() => api.crm.tags.rename(x.id, editing.name))}
                >
                  {t('save')}
                </button>
              </>
            ) : (
              <>
                <span className={ui.chip}>{x.name}</span>
                <span className={ui.muted}>
                  {t('usage', { contacts: x.contactCount, opportunities: x.opportunityCount })}
                </span>
                <button
                  type="button"
                  className={ui.btn}
                  onClick={() => setEditing({ id: x.id, name: x.name })}
                >
                  {t('rename')}
                </button>
                <button
                  type="button"
                  className={ui.btnDanger}
                  onClick={() =>
                    window.confirm(t('confirmDelete', { name: x.name })) &&
                    run(() => api.crm.tags.delete(x.id))
                  }
                >
                  {t('delete')}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={create} className={`${ui.panel} ${ui.row}`}>
        <input
          name="name"
          required
          maxLength={40}
          className={ui.input}
          placeholder={t('newName')}
          aria-label={t('newName')}
        />
        <button className={ui.btnPrimary}>{t('create')}</button>
      </form>
    </div>
  );
}

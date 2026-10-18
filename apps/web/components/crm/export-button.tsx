'use client';
// CSV export (F2.11). Only rendered for users holding crm.export; the server enforces it, applies the
// caller's record visibility, masks opportunity values and audits the export.
import type { CrmEntity } from '@relay/contracts/api/crm';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/api-client';
import { ErrorNote, has, ui, useMe } from './ui';

export function ExportButton({
  entity,
  filter,
  savedListId,
}: {
  entity: CrmEntity;
  filter?: string;
  savedListId?: string;
}) {
  const t = useTranslations('crm.export');
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!has(me, 'crm.export')) return null;
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const csv = await api.crm.exportCsv(savedListId ? { savedListId } : { entity, filter });
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `relay-${savedListId ? 'list' : entity}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className={ui.row}>
      <button type="button" className={ui.btn} disabled={busy} onClick={run}>
        {busy ? t('exporting') : t('button')}
      </button>
      <ErrorNote error={error} />
    </span>
  );
}

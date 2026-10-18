'use client';
// Localized message templates editor (T-208, I1.10 compatible). Placeholders are numeric ({{1}}) so a
// template with a WhatsApp template name shows up in the inbox template picker. `ai.manage` only.
import { AI_LANGS, type TemplateAdminDto } from '@relay/contracts/api/ai';
import { MessageSquareText, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/http/client-error';
import { ConfirmDialog } from '@/components/relay/confirm-dialog';
import { EmptyState } from '@/components/relay/empty-state';
import { FormField } from '@/components/relay/form-field';
import { StatusBadge } from '@/components/relay/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/components/ui/cn';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { fieldClass, Input, Textarea } from '@/components/ui/input';
import { api, localizeError } from '@/lib/api-client';
import { AiAdminShell } from './admin-shell';

type Draft = {
  id?: string;
  key: string;
  locale: TemplateAdminDto['locale'];
  body: string;
  waTemplateName: string;
  waTemplateLang: string;
};
const blank: Draft = { key: '', locale: 'en', body: '', waTemplateName: '', waTemplateLang: '' };
const paramCount = (b: string) => new Set(b.match(/\{\{\d+\}\}/g) ?? []).size;

export function TemplatesEditor() {
  const t = useTranslations('ai');
  const tAll = useTranslations();
  const [items, setItems] = useState<TemplateAdminDto[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<TemplateAdminDto | null>(null);

  const [tick, setTick] = useState(0);
  const load = async () => setTick((n) => n + 1);
  useEffect(() => {
    let live = true;
    api.ai.templates.list().then(
      (d) => {
        if (!live) return;
        setItems(d.items);
        setErr(null);
      },
      (e) => live && setErr(localizeError(e, tAll as never)),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setFormErr(null);
    try {
      const body = {
        key: draft.key.trim(),
        locale: draft.locale,
        body: draft.body,
        waTemplateName: draft.waTemplateName.trim() || null,
        waTemplateLang: draft.waTemplateLang.trim() || null,
      };
      if (draft.id) await api.ai.templates.update(draft.id, body);
      else await api.ai.templates.create(body);
      setDraft(null);
      await load();
    } catch (e) {
      setFormErr(
        e instanceof ApiError && e.code === 'CONFLICT'
          ? t('templates.conflict')
          : localizeError(e, tAll as never),
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!del) return;
    setBusy(true);
    try {
      await api.ai.templates.delete(del.id);
      setDel(null);
      await load();
    } catch (e) {
      setErr(localizeError(e, tAll as never));
      setDel(null);
    } finally {
      setBusy(false);
    }
  }

  const addBtn = (
    <Button variant="primary" onClick={() => setDraft({ ...blank })}>
      <Plus aria-hidden className="size-4" />
      {t('templates.add')}
    </Button>
  );

  // Group by name so the three languages of one message sit together.
  const groups = new Map<string, TemplateAdminDto[]>();
  for (const x of items ?? []) groups.set(x.key, [...(groups.get(x.key) ?? []), x]);

  return (
    <AiAdminShell active="templates">
      <section aria-labelledby="tpl-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 id="tpl-title" className="text-panel text-fg">
              {t('templates.title')}
            </h2>
            <p className="mt-1 text-body text-fg-2">{t('templates.description')}</p>
          </div>
          {items && items.length > 0 ? addBtn : null}
        </div>
        {err ? (
          <p role="alert" className="text-body text-danger">
            {err}
          </p>
        ) : null}
        {!items && !err ? (
          <p aria-busy="true" className="text-body text-fg-2">
            {t('admin.loading')}
          </p>
        ) : null}
        {items && items.length === 0 ? (
          <Card>
            <EmptyState
              icon={MessageSquareText}
              title={t('templates.empty.title')}
              description={t('templates.empty.description')}
              action={addBtn}
            />
          </Card>
        ) : null}

        <ul className="flex flex-col gap-3">
          {[...groups.entries()].map(([key, list]) => (
            <li key={key}>
              <Card className="flex flex-col gap-3">
                <h3 className="text-panel font-mono text-fg" dir="ltr">
                  {key}
                </h3>
                <ul className="flex flex-col divide-y divide-line">
                  {list.map((x) => (
                    <li key={x.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone="neutral">{t(`languages.${x.locale}`)}</StatusBadge>
                        <span className="text-meta text-fg-2">
                          {t('templates.params', { count: paramCount(x.body) })}
                        </span>
                        {x.waTemplateName ? (
                          <StatusBadge tone="success">{t('templates.inPicker')}</StatusBadge>
                        ) : null}
                        <span className="ms-auto flex gap-2">
                          <Button
                            size="sm"
                            onClick={() =>
                              setDraft({
                                id: x.id,
                                key: x.key,
                                locale: x.locale,
                                body: x.body,
                                waTemplateName: x.waTemplateName ?? '',
                                waTemplateLang: x.waTemplateLang ?? '',
                              })
                            }
                          >
                            {t('admin.edit')}
                          </Button>
                          <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDel(x)}>
                            {t('admin.delete')}
                          </Button>
                        </span>
                      </div>
                      <p dir="auto" className="whitespace-pre-wrap text-body text-fg-2">
                        {x.body}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent
          title={draft?.id ? t('templates.editTitle') : t('templates.newTitle')}
          className="max-w-xl"
        >
          {draft ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(ev) => {
                ev.preventDefault();
                void save();
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  label={t('templates.fields.key')}
                  helper={t('templates.fields.keyHelper')}
                  required
                >
                  {(p) => (
                    <Input
                      {...p}
                      dir="ltr"
                      maxLength={60}
                      value={draft.key}
                      onChange={(e) => setDraft({ ...draft, key: e.target.value.toLowerCase() })}
                    />
                  )}
                </FormField>
                <FormField label={t('templates.fields.language')}>
                  {(p) => (
                    <select
                      {...p}
                      className={cn(fieldClass, 'h-11 sm:h-10')}
                      value={draft.locale}
                      onChange={(e) => setDraft({ ...draft, locale: e.target.value as Draft['locale'] })}
                    >
                      {AI_LANGS.map((l) => (
                        <option key={l} value={l}>
                          {t(`languages.${l}`)}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
              </div>
              <FormField
                label={t('templates.fields.body')}
                helper={t('templates.fields.bodyHelper')}
                required
              >
                {(p) => (
                  <Textarea
                    {...p}
                    dir="auto"
                    rows={5}
                    maxLength={1024}
                    value={draft.body}
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  />
                )}
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label={t('templates.fields.waName')} helper={t('templates.fields.waNameHelper')}>
                  {(p) => (
                    <Input
                      {...p}
                      dir="ltr"
                      maxLength={80}
                      value={draft.waTemplateName}
                      onChange={(e) => setDraft({ ...draft, waTemplateName: e.target.value })}
                    />
                  )}
                </FormField>
                <FormField label={t('templates.fields.waLang')}>
                  {(p) => (
                    <Input
                      {...p}
                      dir="ltr"
                      maxLength={10}
                      value={draft.waTemplateLang}
                      onChange={(e) => setDraft({ ...draft, waTemplateLang: e.target.value })}
                    />
                  )}
                </FormField>
              </div>
              {formErr ? (
                <p role="alert" className="text-body text-danger">
                  {formErr}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="button" onClick={() => setDraft(null)}>
                  {t('admin.cancel')}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  loading={busy}
                  disabled={!draft.key.trim() || !draft.body.trim()}
                >
                  {t('admin.save')}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title={del ? `${del.key} · ${t(`languages.${del.locale}`)}` : ''}
        description={t('templates.confirmDelete')}
        confirmLabel={t('admin.delete')}
        destructive
        loading={busy}
        onConfirm={remove}
      />
    </AiAdminShell>
  );
}

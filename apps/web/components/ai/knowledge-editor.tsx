'use client';
// Knowledge base editor (T-208, F6.5): the entries the AI stand-in answers from. `ai.manage` only.
import { AI_LANGS, KB_KINDS, type KbEntryDto } from '@relay/contracts/api/ai';
import { BookOpen, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
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
import { AiAdminShell, Toggle } from './admin-shell';

type Draft = {
  id?: string;
  kind: KbEntryDto['kind'];
  title: string;
  body: string;
  language: KbEntryDto['language'];
  enabled: boolean;
};
const blank: Draft = { kind: 'faq', title: '', body: '', language: 'en', enabled: true };

export function KnowledgeEditor() {
  const t = useTranslations('ai');
  const tAll = useTranslations();
  const [items, setItems] = useState<KbEntryDto[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<KbEntryDto | null>(null);

  const [tick, setTick] = useState(0);
  const load = async () => setTick((n) => n + 1);
  useEffect(() => {
    let live = true;
    api.ai.knowledge.list().then(
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
      const { id, ...body } = draft;
      if (id) await api.ai.knowledge.update(id, body);
      else await api.ai.knowledge.create(body);
      setDraft(null);
      await load();
    } catch (e) {
      setFormErr(localizeError(e, tAll as never));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!del) return;
    setBusy(true);
    try {
      await api.ai.knowledge.delete(del.id);
      setDel(null);
      await load();
    } catch (e) {
      setErr(localizeError(e, tAll as never));
      setDel(null);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(e: KbEntryDto, enabled: boolean) {
    setItems((cur) => cur?.map((x) => (x.id === e.id ? { ...x, enabled } : x)) ?? cur);
    try {
      await api.ai.knowledge.update(e.id, { enabled });
    } catch (x) {
      setErr(localizeError(x, tAll as never));
      await load();
    }
  }

  const addBtn = (
    <Button variant="primary" onClick={() => setDraft({ ...blank })}>
      <Plus aria-hidden className="size-4" />
      {t('knowledge.add')}
    </Button>
  );

  return (
    <AiAdminShell active="knowledge">
      <section aria-labelledby="kb-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 id="kb-title" className="text-panel text-fg">
              {t('knowledge.title')}
            </h2>
            <p className="mt-1 text-body text-fg-2">{t('knowledge.description')}</p>
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
              icon={BookOpen}
              title={t('knowledge.empty.title')}
              description={t('knowledge.empty.description')}
              action={addBtn}
            />
          </Card>
        ) : null}

        <ul className="flex flex-col gap-3">
          {items?.map((e) => (
            <li key={e.id}>
              <Card className={cn('flex flex-col gap-3', !e.enabled && 'opacity-70')}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-panel min-w-0 flex-1 text-fg">{e.title}</h3>
                  <StatusBadge tone="info">{t(`knowledge.kinds.${e.kind}`)}</StatusBadge>
                  <StatusBadge tone="neutral">{t(`languages.${e.language}`)}</StatusBadge>
                  {!e.enabled ? <StatusBadge tone="disabled">{t('knowledge.disabled')}</StatusBadge> : null}
                </div>
                <p dir="auto" className="line-clamp-3 whitespace-pre-wrap text-body text-fg-2">
                  {e.body}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Toggle
                    checked={e.enabled}
                    onChange={(v) => toggle(e, v)}
                    label={<span className="text-meta">{t('knowledge.fields.enabled')}</span>}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => setDraft({ ...e })}>
                      {t('admin.edit')}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDel(e)}>
                      {t('admin.delete')}
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent
          title={draft?.id ? t('knowledge.editTitle') : t('knowledge.newTitle')}
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
              <FormField label={t('knowledge.fields.title')} required>
                {(p) => (
                  <Input
                    {...p}
                    dir="auto"
                    maxLength={120}
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  />
                )}
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label={t('knowledge.fields.kind')}>
                  {(p) => (
                    <select
                      {...p}
                      className={cn(fieldClass, 'h-11 sm:h-10')}
                      value={draft.kind}
                      onChange={(e) => setDraft({ ...draft, kind: e.target.value as Draft['kind'] })}
                    >
                      {KB_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {t(`knowledge.kinds.${k}`)}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
                <FormField label={t('knowledge.fields.language')}>
                  {(p) => (
                    <select
                      {...p}
                      className={cn(fieldClass, 'h-11 sm:h-10')}
                      value={draft.language}
                      onChange={(e) => setDraft({ ...draft, language: e.target.value as Draft['language'] })}
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
                label={t('knowledge.fields.content')}
                helper={`${t('knowledge.fields.contentHelper')} ${t('knowledge.countHint', { count: draft.body.length })}`}
                required
              >
                {(p) => (
                  <Textarea
                    {...p}
                    dir="auto"
                    rows={7}
                    maxLength={2000}
                    value={draft.body}
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  />
                )}
              </FormField>
              <Toggle
                checked={draft.enabled}
                onChange={(v) => setDraft({ ...draft, enabled: v })}
                label={t('knowledge.fields.enabled')}
              />
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
                  disabled={!draft.title.trim() || !draft.body.trim()}
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
        title={del?.title ?? ''}
        description={t('knowledge.confirmDelete')}
        confirmLabel={t('admin.delete')}
        destructive
        loading={busy}
        onConfirm={remove}
      />
    </AiAdminShell>
  );
}

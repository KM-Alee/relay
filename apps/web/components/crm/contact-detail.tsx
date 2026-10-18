'use client';
// Contact 360 (T-117, F2.8) + editing with optimistic-lock conflict UI (T-110, Q4), tags (T-114), custom
// fields (T-112), notes and call logs (T-116). Every related record on one page.
import type { ActivityDto, FieldValue } from '@relay/contracts/api/crm';
import { useFormatter, useTranslations } from 'next-intl';
import { Fragment, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { Link } from '@/lib/i18n/navigation';
import { AIBadge } from '@/components/relay/ai-badge';
import { AiFieldsPanel } from './ai-fields-panel';
import { OpportunityPayments, PaymentStatusBadge } from './opportunity-payments';
import { ErrorNote, FieldInput, Money, has, ui, useFieldLabel, useFieldText, useLoad, useMe } from './ui';

export function ContactDetail({ id }: { id: string }) {
  const t = useTranslations('crm.detail');
  const me = useMe();
  const view = useLoad(() => api.crm.contacts.view360(id), `360:${id}`);
  const fields = useLoad(() => api.crm.fields.list({ entity: 'contact' }), 'fields:contact');
  const tags = useLoad(() => api.crm.tags.list(), 'tags');
  const users = useLoad(() => api.users.list({ limit: 100 }).catch(() => null), 'users');
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);
  const [entryType, setEntryType] = useState<'note' | 'call'>('note');
  type Form = {
    name: string;
    phone: string;
    email: string;
    ownerUserId: string;
    fields: Record<string, FieldValue | null>;
  };
  const [edits, setForm] = useState<Form | null>(null);
  const [more, setMore] = useState<ActivityDto[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const fmt = useFormatter();
  const fieldLabel = useFieldLabel();
  const fieldText = useFieldText();

  const contact = view.data?.contact;
  const form: Form | null = contact
    ? (edits ?? {
        name: contact.name,
        phone: contact.phoneE164 ?? '',
        email: contact.email ?? '',
        ownerUserId: contact.ownerUserId ?? '',
        fields: { ...contact.fields },
      })
    : null;

  if (view.error) return <ErrorNote error={view.error} />;
  if (!view.data || !contact || !form) return <p aria-busy="true">{t('loading')}</p>;
  const d = view.data;
  const canEdit = has(me, 'crm.contact.edit');
  const aiIds = new Set((fields.data?.items ?? []).filter((f) => f.type === 'ai').map((f) => f.id));
  const fieldDefs = (fields.data?.items ?? []).filter((f) => f.type !== 'ai');
  const owners = [
    ...(users.data?.items.map((u) => ({ id: u.id, name: u.name })) ?? []),
    ...(me ? [{ id: me.user.id, name: me.user.name }] : []),
    ...(contact.ownerUserId ? [{ id: contact.ownerUserId, name: contact.ownerName ?? '' }] : []),
  ].filter((o, i, a) => a.findIndex((x) => x.id === o.id) === i);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form || !contact) return;
    try {
      await api.crm.contacts.update(id, {
        version: contact.version,
        name: form.name,
        phone: form.phone || null,
        email: form.email || null,
        ownerUserId: form.ownerUserId || null,
        // AI fields are edited in their own panel: re-saving them here would lock them as human-set.
        fields: Object.fromEntries(Object.entries(form.fields).filter(([k]) => !aiIds.has(k))),
      });
      setError(null);
      setConflict(false);
      setForm(null);
      view.reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STALE_VERSION') setConflict(true);
      else setError(err);
    }
  }

  async function tagAction(tagId: string, attach: boolean) {
    try {
      await (attach ? api.crm.contacts.addTag(id, tagId) : api.crm.contacts.removeTag(id, tagId));
      view.reload();
    } catch (err) {
      setError(err);
    }
  }

  async function addActivity(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const type = String(f.get('type')) as 'note' | 'call';
    try {
      await api.crm.activities.create({
        contactId: id,
        type,
        body: String(f.get('body')),
        ...(type === 'call'
          ? {
              direction: String(f.get('direction')) as 'inbound' | 'outbound',
              outcome: String(f.get('outcome')) as 'connected',
              durationSeconds: Number(f.get('minutes') || 0) * 60,
            }
          : {}),
      });
      form.reset();
      setError(null);
      setMore([]);
      setCursor(undefined);
      view.reload();
    } catch (err) {
      setError(err);
    }
  }

  async function loadOlder() {
    const c = cursor === undefined ? d.timeline.nextCursor : cursor;
    if (!c) return;
    try {
      const r = await api.crm.contacts.timeline(id, { cursor: c, limit: 30 });
      setMore((m) => [...m, ...r.items]);
      setCursor(r.nextCursor);
    } catch (err) {
      setError(err);
    }
  }

  const timeline = [...d.timeline.items, ...more];
  const olderCursor = cursor === undefined ? d.timeline.nextCursor : cursor;
  const attachable = (tags.data?.items ?? []).filter((x) => !contact.tags.some((c) => c.id === x.id));

  return (
    <div className="space-y-4">
      <header className={`${ui.row} justify-between`}>
        <div>
          <h1 className={ui.h1}>{contact.name}</h1>
          <p className={ui.muted}>
            <span dir="ltr">{contact.phoneE164}</span> {contact.email && `· ${contact.email}`}
            {contact.optedOut && ` · ${t('optedOut')}`}
          </p>
        </div>
        <div className={ui.row}>
          {has(me, 'appointments.manage') && (
            <Link
              href={{
                pathname: '/appointments',
                query: { book: '1', contactId: id, contactName: contact.name },
              }}
              className={ui.btnPrimary}
            >
              {t('bookAppointment')}
            </Link>
          )}
          <Link href="/contacts" className={ui.btn}>
            {t('back')}
          </Link>
        </div>
      </header>

      {conflict && (
        <div role="alert" className={ui.alert}>
          <p>{t('conflict')}</p>
          <button
            type="button"
            className={ui.btn}
            onClick={() => {
              setConflict(false);
              setError(null);
              setForm(null);
              view.reload();
            }}
          >
            {t('loadLatest')}
          </button>
        </div>
      )}
      {!conflict && <ErrorNote error={error} />}

      <section className={ui.card} aria-labelledby="sec-details">
        <h2 id="sec-details" className={ui.h2}>
          {t('details')}
        </h2>
        <form onSubmit={save} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={ui.muted}>{t('name')}</span>
            <input
              className={ui.input}
              value={form.name}
              disabled={!canEdit}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={ui.muted}>{t('phone')}</span>
            <input
              className={ui.input}
              dir="ltr"
              value={form.phone}
              disabled={!canEdit}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={ui.muted}>{t('email')}</span>
            <input
              className={ui.input}
              type="email"
              value={form.email}
              disabled={!canEdit}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={ui.muted}>{t('owner')}</span>
            <select
              className={ui.input}
              value={form.ownerUserId}
              disabled={!canEdit}
              onChange={(e) => setForm({ ...form, ownerUserId: e.target.value })}
            >
              <option value="">{t('unassigned')}</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          {fieldDefs.map((f) => (
            <FieldInput
              key={f.id}
              field={f}
              value={form.fields[f.id] ?? undefined}
              onChange={(v) => setForm({ ...form, fields: { ...form.fields, [f.id]: v } })}
            />
          ))}
          {canEdit && (
            <div className="sm:col-span-2">
              <button className={ui.btnPrimary}>{t('save')}</button>
            </div>
          )}
        </form>
      </section>

      <AiFieldsPanel
        contactId={id}
        contactVersion={contact.version}
        canEdit={canEdit}
        onChanged={view.reload}
      />

      <section className={ui.card} aria-labelledby="sec-tags">
        <h2 id="sec-tags" className={ui.h2}>
          {t('tags')}
        </h2>
        <div className={ui.row}>
          {contact.tags.map((x) => (
            <span key={x.id} className={ui.chip}>
              {x.name}
              {canEdit && (
                <button
                  type="button"
                  aria-label={t('removeTag', { name: x.name })}
                  onClick={() => tagAction(x.id, false)}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {canEdit && attachable.length > 0 && (
            <select
              className={ui.input}
              aria-label={t('addTag')}
              value=""
              onChange={(e) => e.target.value && tagAction(e.target.value, true)}
            >
              <option value="">{t('addTag')}</option>
              {attachable.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </section>

      <section className={ui.card} aria-labelledby="sec-company">
        <h2 id="sec-company" className={ui.h2}>
          {t('company')}
        </h2>
        <p>
          {d.company
            ? `${d.company.name} (${t('contactCount', { count: d.company.contactCount })})`
            : t('none')}
        </p>
      </section>

      <section className={ui.card} aria-labelledby="sec-opps">
        <h2 id="sec-opps" className={ui.h2}>
          {t('opportunities')}
        </h2>
        {d.opportunities.length === 0 ? (
          <p className={ui.muted}>{t('none')}</p>
        ) : (
          <table className={ui.table}>
            <tbody>
              {d.opportunities.map((o) => (
                <Fragment key={o.id}>
                  <tr>
                    <td className={ui.td}>{o.title}</td>
                    <td className={ui.td}>
                      <Money value={o.value} />
                    </td>
                    <td className={ui.td}>{o.ownerName}</td>
                    <td className={ui.td}>
                      {fmt.dateTime(new Date(o.stageEnteredAt), { dateStyle: 'medium' })}
                    </td>
                  </tr>
                  {has(me, 'payments.request') && (
                    <tr>
                      <td colSpan={4} className={ui.td}>
                        <OpportunityPayments
                          opportunityId={o.id}
                          contactId={id}
                          hasPhone={!!contact.phoneE164}
                          onChange={view.reload}
                          defaultValue={o.value && !o.value.masked ? o.value : null}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {(['conversations', 'payments', 'appointments'] as const).map((k) => (
        <section key={k} className={ui.card} aria-labelledby={`sec-${k}`}>
          <h2 id={`sec-${k}`} className={ui.h2}>
            {t(k)}
          </h2>
          {d.related[k].length === 0 ? (
            <p className={ui.muted}>{t('none')}</p>
          ) : (
            <ul>
              {d.related[k].map((r) => (
                <li key={r.id}>
                  {r.label}{' '}
                  {r.status &&
                    (k === 'payments' ? (
                      <PaymentStatusBadge status={r.status as never} />
                    ) : (
                      <span className={ui.chip}>{r.status}</span>
                    ))}
                  {r.at && (
                    <span className={ui.muted}>
                      {' '}
                      · {fmt.dateTime(new Date(r.at), { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <section className={ui.card} aria-labelledby="sec-ai">
        <h2 id="sec-ai" className={ui.h2}>
          {t('aiProfile')} <AIBadge />
        </h2>
        {Object.keys(contact.aiProfile).length === 0 ? (
          <p className={ui.muted}>{t('aiProfileEmpty')}</p>
        ) : (
          <dl>
            {Object.entries(contact.aiProfile).map(([k, v]) => (
              <div key={k} className={ui.row}>
                <dt className={ui.muted}>{k}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
        {fieldDefs.length > 0 && (
          <p className="sr-only">
            {fieldDefs.map((f) => `${fieldLabel(f)}: ${fieldText(f, contact.fields[f.id])}`).join(', ')}
          </p>
        )}
      </section>

      <section className={ui.card} aria-labelledby="sec-timeline">
        <h2 id="sec-timeline" className={ui.h2}>
          {t('timeline')}
        </h2>
        {canEdit && (
          <form onSubmit={addActivity} className={`${ui.row} mb-3`}>
            <select
              name="type"
              className={ui.input}
              aria-label={t('entryType')}
              value={entryType}
              onChange={(e) => setEntryType(e.target.value as 'note' | 'call')}
            >
              <option value="note">{t('types.note')}</option>
              <option value="call">{t('types.call')}</option>
            </select>
            <input
              name="body"
              required
              className={`${ui.input} min-w-48 flex-1`}
              placeholder={t('bodyPlaceholder')}
              aria-label={t('bodyPlaceholder')}
            />
            {entryType === 'call' && (
              <>
                <select
                  name="direction"
                  className={ui.input}
                  aria-label={t('direction')}
                  defaultValue="outbound"
                >
                  <option value="outbound">{t('outbound')}</option>
                  <option value="inbound">{t('inbound')}</option>
                </select>
                <select
                  name="outcome"
                  className={ui.input}
                  aria-label={t('outcome')}
                  defaultValue="connected"
                >
                  {(['connected', 'no_answer', 'voicemail', 'busy', 'wrong_number'] as const).map((o) => (
                    <option key={o} value={o}>
                      {t(`outcomes.${o}`)}
                    </option>
                  ))}
                </select>
                <input
                  name="minutes"
                  type="number"
                  min={0}
                  className={`${ui.input} w-20`}
                  placeholder={t('minutes')}
                  aria-label={t('minutes')}
                />
              </>
            )}
            <button className={ui.btnPrimary}>{t('add')}</button>
          </form>
        )}
        <ol className="space-y-2">
          {timeline.map((a) => (
            <li key={a.id} className="border-b border-[var(--border)] pb-2">
              <div className={ui.row}>
                <strong>{t(`types.${a.type}`)}</strong>
                {a.ai && <AIBadge />}
                <span className={ui.muted}>
                  {a.ai ? t('byAi') : a.actorName ? t('by', { name: a.actorName }) : t('bySystem')} ·{' '}
                  {fmt.dateTime(new Date(a.occurredAt), { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </div>
              <ActivityBody a={a} />
            </li>
          ))}
        </ol>
        {olderCursor && (
          <button type="button" className={ui.btn} onClick={loadOlder}>
            {t('older')}
          </button>
        )}
      </section>
    </div>
  );
}

function ActivityBody({ a }: { a: ActivityDto }) {
  const t = useTranslations('crm.detail');
  const tp = useTranslations('crm.payments');
  const p = a.payload as Record<string, unknown>;
  if (a.type === 'note') return <p>{String(p.body ?? '')}</p>;
  if (a.type === 'call')
    return (
      <p>
        {t('callLine', {
          direction: t(p.direction === 'inbound' ? 'inbound' : 'outbound'),
          outcome: t(`outcomes.${String(p.outcome ?? 'connected')}` as 'outcomes.connected'),
          minutes: Math.round(Number(p.durationSeconds ?? 0) / 60),
        })}{' '}
        {String(p.summary ?? '')}
      </p>
    );
  if (a.type === 'stage_change')
    return <p>{t('stageLine', { from: String(p.fromStage ?? ''), to: String(p.toStage ?? '') })}</p>;
  if (a.type === 'field_edit' && Array.isArray(p.changes))
    return (
      <p>{t('editedLine', { fields: (p.changes as { key: string }[]).map((c) => c.key).join(', ') })}</p>
    );
  if (a.type === 'payment')
    return (
      <p>
        {t('paymentLine', {
          status: tp(`status.${String(p.status ?? 'pending')}` as 'status.paid'),
        })}
      </p>
    );
  if (a.type === 'appointment')
    return <p>{t('appointmentLine', { what: String(p.what ?? ''), title: String(p.title ?? '') })}</p>;
  if (a.type === 'assignment') return <p>{t('assignedLine')}</p>;
  if (typeof p.body === 'string') return <p>{p.body}</p>;
  return null;
}

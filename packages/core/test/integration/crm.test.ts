// [F2.1][F2.4][F2.5][F2.6][F2.11][F1.4][F1.6][Q2][Q4] CRM Done-when proofs on real Postgres (T-110…T-118).
import { randomUUID } from 'node:crypto';
import { closeDb } from '@relay/db';
import { afterAll, describe, expect, it } from 'vitest';
import { withOwner } from '../../../db/test/helpers';
import type { Actor } from '../../src/auth/actor';
import { hashPassword } from '../../src/auth/passwords';
import { resolveSession } from '../../src/auth/sessions';
import { authService } from '../../src/services/auth';
import { customFieldsService, tagsService } from '../../src/services/crm-config';
import { moveOpportunity, pipelinesService } from '../../src/services/crm-pipelines';
import { contactsService, opportunitiesService } from '../../src/services/crm-records';
import { exportsService, neutralizeCell } from '../../src/services/exports';
import { listsService } from '../../src/services/lists';

afterAll(async () => {
  await closeDb();
});

const PASSWORD = 'correct horse battery';
const q = (sql: string, p: unknown[] = []) => withOwner((c) => c.query(sql, p));

async function workspace() {
  const o = await authService.signup(
    { workspaceName: 'CRM', name: 'Owner', email: `o-${randomUUID()}@t.test`, password: PASSWORD },
    { ip: '10.7.7.7' },
  );
  const ws = o.me.workspace.id;
  const userId = randomUUID();
  const email = `u-${randomUUID()}@t.test`;
  await q(
    `insert into users (id, workspace_id, email, name, password_hash, base_level) values ($1,$2,$3,'Plain',$4,'user')`,
    [userId, ws, email, await hashPassword(PASSWORD)],
  );
  const u = await authService.login(
    { email, password: PASSWORD },
    { ip: `10.6.${Math.floor(Math.random() * 250)}.1` },
  );
  const owner = (await resolveSession(o.session.token))!.actor;
  const plain = (await resolveSession(u.session.token))!.actor;
  return { ws, owner, plain, userId };
}

const withPerm = (a: Actor, ...keys: string[]): Actor => ({
  ...a,
  permissions: new Set([...a.permissions, ...keys]) as Actor['permissions'],
});

describe('CRM Done-when proofs', () => {
  it('[Q4][F2.1] a stale edit gets 409 STALE_VERSION carrying the current record', async () => {
    const { owner } = await workspace();
    const c = await contactsService.create(owner, { name: 'Ali Raza' });
    const edited = await contactsService.update(owner, c.id, { name: 'Ali R.', version: c.version });
    expect(edited.version).toBe(c.version + 1);
    const err = await contactsService
      .update(owner, c.id, { name: 'Stale', version: c.version })
      .catch((e) => e);
    expect(err).toMatchObject({ code: 'STALE_VERSION', httpStatus: 409 });
    expect((err.details.current as { name: string }).name).toBe('Ali R.');
  });

  it('[F2.4] a move into a stage with required fields is rejected with REQUIRED_FIELDS_MISSING, and passes once filled', async () => {
    const { owner } = await workspace();
    const [pipeline] = (await pipelinesService.list(owner)).items;
    const [stNew, stQual] = pipeline!.stages;
    const field = await customFieldsService.create(owner, {
      entity: 'opportunity',
      pipelineId: null,
      key: 'site_visit',
      label: { en: 'Site visit', ur: 'سائٹ وزٹ' },
      type: 'checkbox',
      options: [],
    });
    await pipelinesService.updateStage(owner, stQual!.id, {
      requiredFieldIds: [field.id],
      version: stQual!.version,
    });
    const contact = await contactsService.create(owner, { name: 'Sara' });
    const opp = await opportunitiesService.create(owner, {
      contactId: contact.id,
      title: 'Deal',
      stageId: stNew!.id,
    });
    const err = await moveOpportunity(owner, opp.id, { stageId: stQual!.id, version: opp.version }).catch(
      (e) => e,
    );
    expect(err).toMatchObject({ code: 'REQUIRED_FIELDS_MISSING', httpStatus: 422 });
    expect(err.details.fields.map((f: { key: string }) => f.key)).toEqual(['site_visit']);
    const moved = await moveOpportunity(owner, opp.id, {
      stageId: stQual!.id,
      version: opp.version,
      fields: { [field.id]: true },
    });
    expect(moved.stageId).toBe(stQual!.id);
  });

  it('[F2.5] deleting a non-empty stage needs a target; the opportunities are moved in the same transaction', async () => {
    const { owner } = await workspace();
    const [pipeline] = (await pipelinesService.list(owner)).items;
    const [a, b] = pipeline!.stages;
    const contact = await contactsService.create(owner, { name: 'Hamza' });
    const opp = await opportunitiesService.create(owner, {
      contactId: contact.id,
      title: 'D',
      stageId: a!.id,
    });
    await expect(pipelinesService.deleteStage(owner, a!.id, {})).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      details: { reason: 'move_target_required' },
    });
    expect((await pipelinesService.deleteStage(owner, a!.id, { moveToStageId: b!.id })).movedCount).toBe(1);
    expect((await opportunitiesService.get(owner, opp.id)).stageId).toBe(b!.id);
  });

  it('[F2.6][F2.1] list membership follows the data with no manual action; deleting a tag leaves no dangling joins', async () => {
    const { owner } = await workspace();
    const tag = await tagsService.create(owner, { name: 'Solar' });
    const a = await contactsService.create(owner, { name: 'A' });
    const b = await contactsService.create(owner, { name: 'B' });
    const list = await listsService.create(owner, {
      name: 'Solar',
      entity: 'contact',
      isShared: false,
      criteria: {
        match: 'all',
        clauses: [
          { field: 'tag', op: 'in', value: [tag.id] },
          { field: 'created_at', op: 'within_days', value: 7 },
          { field: 'owner', op: 'in', value: [owner.userId] },
        ],
      },
    });
    const names = async () => (await listsService.items(owner, list.id, {})).items.map((i) => i.id).sort();
    expect(await names()).toEqual([]);
    await contactsService.tag(owner, a.id, tag.id, true);
    expect(await names()).toEqual([a.id]);
    await contactsService.tag(owner, b.id, tag.id, true);
    await contactsService.tag(owner, a.id, tag.id, false);
    expect(await names()).toEqual([b.id]);
    await tagsService.remove(owner, tag.id);
    const dangling = await q(`select count(*)::int as n from contact_tags where tag_id = $1`, [tag.id]);
    expect(dangling.rows[0].n).toBe(0);
    expect((await listsService.list(owner)).items[0]!.needsReview).toBe(true);
  });

  it('[F2.11][F1.4] export for a user without the value permission has masked values; formula cells are neutralised and the export is audited', async () => {
    const { ws, owner, plain } = await workspace();
    const exporter = withPerm(plain, 'crm.export');
    const contact = await contactsService.create(exporter, { name: '=HYPERLINK("http://evil")' });
    await opportunitiesService.create(owner, {
      contactId: contact.id,
      title: 'Secret deal',
      valueMinor: 123_456_700,
      ownerUserId: plain.userId,
    });
    const masked = await exportsService.create(exporter, { entity: 'opportunity' });
    expect(masked.csv).toContain('Secret deal');
    expect(masked.csv).toContain('[masked]');
    expect(masked.csv).not.toContain('1234567');
    const full = await exportsService.create(owner, { entity: 'opportunity' });
    expect(full.csv).toContain('1234567');
    const contacts = await exportsService.create(exporter, { entity: 'contact' });
    expect(contacts.csv).toContain(`'=HYPERLINK`);
    expect(neutralizeCell('@x')).toBe("'@x");
    await expect(exportsService.create(plain, { entity: 'contact' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const audit = await q(
      `select meta from audit_events where workspace_id = $1 and action = 'crm.exported' order by seq`,
      [ws],
    );
    expect(audit.rows.map((r) => r.meta.rowCount)).toEqual([1, 1, 1]);
    expect(audit.rows[0]!.meta.valuesMasked).toBe(true);
  });

  it('[F1.6][Q2] out-of-scope and other-workspace ids are 404; a User sees only their own contacts and opportunities', async () => {
    const a = await workspace();
    const b = await workspace();
    const ownersContact = await contactsService.create(a.owner, { name: 'Owner only' });
    const mine = await contactsService.create(a.plain, { name: 'Mine' });
    await expect(contactsService.get(a.plain, ownersContact.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      httpStatus: 404,
    });
    await expect(contactsService.get(b.owner, ownersContact.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      contactsService.update(a.plain, ownersContact.id, { name: 'x', version: 0 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await contactsService.list(a.plain, {})).items.map((c) => c.id)).toEqual([mine.id]);
    expect((await contactsService.list(a.owner, {})).items.length).toBe(2);
    const opp = await opportunitiesService.create(a.owner, { contactId: ownersContact.id, title: 'Hidden' });
    await expect(opportunitiesService.get(a.plain, opp.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // value is masked for the plain user on their own opportunity (F1.4)
    const own = await opportunitiesService.create(a.owner, {
      contactId: mine.id,
      title: 'Visible',
      valueMinor: 500_000,
    });
    expect((await opportunitiesService.get(a.plain, own.id)).value).toEqual({ masked: true });
  });
});

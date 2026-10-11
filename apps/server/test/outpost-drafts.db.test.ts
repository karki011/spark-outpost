import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OutpostDraft } from '@spark-outpost/contracts';
import {
  getDraft,
  markReported,
  markStarted,
  saveDraft,
} from '../src/persistence/outpost-drafts.ts';
import type { NewDraft } from '../src/outposts/ports.ts';
import { createOutpostRow } from './outpost-fixtures.ts';
import { chatWithTurn } from './outpost-store-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let lead: { conversationId: string; runId: string };

const body: OutpostDraft = {
  name: 'Orders launch',
  title: 'Checkout',
  chats: [
    { handle: 'api', title: 'Orders endpoint', projectId: randomUUID(), task: 'Add the endpoint.' },
  ],
};

function draft(overrides: Partial<NewDraft> = {}): NewDraft {
  return {
    id: randomUUID(),
    workspaceId: t.workspaceId,
    conversationId: lead.conversationId,
    runId: lead.runId,
    outpostId: null,
    body,
    ...overrides,
  };
}

beforeEach(async () => {
  t = await createTestDb();
  lead = await chatWithTurn(t);
});

afterEach(async () => {
  await t.cleanup();
});

describe('outpost drafts', () => {
  it('saves a draft under its story title and reads it back in its workspace only', async () => {
    const saved = await saveDraft(t.db, draft());

    expect(saved).toMatchObject({
      conversationId: lead.conversationId,
      runId: lead.runId,
      outpostId: null,
      title: 'Checkout',
      body,
      startedAt: null,
      reportedAt: null,
    });
    expect(await getDraft(t.db, t.workspaceId, saved.id)).toEqual(saved);
    expect(await getDraft(t.db, randomUUID(), saved.id)).toBeNull();
    expect(await getDraft(t.db, t.workspaceId, randomUUID())).toBeNull();
  });

  it('keeps the first draft when the same id is saved again', async () => {
    const first = await saveDraft(t.db, draft());

    const again = await saveDraft(
      t.db,
      draft({ id: first.id, body: { ...body, title: 'Something else' } }),
    );

    expect(again).toEqual(first);
    const { rowCount } = await t.db.query('SELECT 1 FROM outpost_drafts');
    expect(rowCount).toBe(1);
  });

  it('is started by one outpost: the same outpost again is fine, another is refused', async () => {
    const saved = await saveDraft(t.db, draft());
    const [first, second] = [await createOutpostRow(t), await createOutpostRow(t, 'Second')];

    expect(await markStarted(t.db, saved.id, first)).toBe(true);
    const started = await getDraft(t.db, t.workspaceId, saved.id);
    expect(await markStarted(t.db, saved.id, first)).toBe(true);
    expect(await markStarted(t.db, saved.id, second)).toBe(false);

    const after = await getDraft(t.db, t.workspaceId, saved.id);
    expect(after).toMatchObject({ outpostId: first, startedAt: started?.startedAt });
    expect(after?.startedAt).not.toBeNull();
  });

  it('lets only one of two outposts that start the same draft at once win', async () => {
    const saved = await saveDraft(t.db, draft());
    const outposts = [await createOutpostRow(t), await createOutpostRow(t, 'Second')];

    const won = await Promise.all(outposts.map((id) => markStarted(t.db, saved.id, id)));

    expect(won.filter(Boolean)).toHaveLength(1);
    const winner = outposts[won.indexOf(true)];
    expect((await getDraft(t.db, t.workspaceId, saved.id))?.outpostId).toBe(winner);
  });

  it('stays started for good after its outpost is deleted', async () => {
    const saved = await saveDraft(t.db, draft());
    const [first, second] = [await createOutpostRow(t), await createOutpostRow(t, 'Second')];
    await markStarted(t.db, saved.id, first);

    await t.db.query('DELETE FROM outposts WHERE id = $1', [first]);

    expect(await markStarted(t.db, saved.id, second)).toBe(false);
    expect(await getDraft(t.db, t.workspaceId, saved.id)).toMatchObject({ outpostId: null });
  });

  it('is reported once, and only after it started', async () => {
    const saved = await saveDraft(t.db, draft());
    expect(await markReported(t.db, saved.id)).toBe(false);
    await markStarted(t.db, saved.id, await createOutpostRow(t));

    const claims = await Promise.all([1, 2, 3].map(() => markReported(t.db, saved.id)));

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await markReported(t.db, saved.id)).toBe(false);
    expect((await getDraft(t.db, t.workspaceId, saved.id))?.reportedAt).not.toBeNull();
    expect(await markReported(t.db, randomUUID())).toBe(false);
  });

  it('keeps the draft, without its chat and turn, when the lead chat is deleted', async () => {
    const saved = await saveDraft(t.db, draft());

    await t.db.query('DELETE FROM conversations WHERE id = $1', [lead.conversationId]);

    expect(await getDraft(t.db, t.workspaceId, saved.id)).toMatchObject({
      conversationId: null,
      runId: null,
      title: 'Checkout',
    });
  });

  it('reads a draft whose stored body is no longer valid as missing', async () => {
    const saved = await saveDraft(t.db, draft());
    await t.db.query(`UPDATE outpost_drafts SET body = '{"chats": []}' WHERE id = $1`, [saved.id]);

    expect(await getDraft(t.db, t.workspaceId, saved.id)).toBeNull();
  });
});

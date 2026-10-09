import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  CHAT_ALREADY_IN_OUTPOST,
  createOutpost,
  deleteOutpost,
  getOutpost,
  listOutposts,
  OUTPOST_ID_IN_USE,
  OutpostError,
  outpostOf,
  removeMember,
  renameHandle,
  setName,
  setPaused,
  TERMINAL_CANNOT_JOIN,
} from '../src/persistence/outposts.ts';
import { newChat } from './outpost-store-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function outpost(
  name = 'Orders launch',
  members: { conversationId: string; handle: string }[] = [],
) {
  return createOutpost(t.db, { id: randomUUID(), workspaceId: t.workspaceId, name, members });
}

async function refusal(work: Promise<unknown>): Promise<{ status: number; message: string }> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(OutpostError);
  const { status, message } = error as OutpostError;
  return { status, message };
}

describe('outposts', () => {
  it('creates an outpost with its members in order and reads it back', async () => {
    const [fe, api] = [await newChat(t), await newChat(t)];
    const created = await outpost('Orders launch', [
      { conversationId: fe, handle: 'fe' },
      { conversationId: api, handle: 'api' },
    ]);

    expect(created).toMatchObject({ name: 'Orders launch', pausedAt: null });
    expect(created.members.map((member) => [member.handle, member.position])).toEqual([
      ['fe', 1],
      ['api', 2],
    ]);
    expect(created.createdAt).toBe(new Date(created.createdAt).toISOString());
    expect(created.members[0]?.joinedAt).toBe(
      new Date(created.members[0]?.joinedAt ?? '').toISOString(),
    );
    expect(await getOutpost(t.db, t.workspaceId, created.id)).toEqual(created);
    expect(await listOutposts(t.db, t.workspaceId)).toEqual([created]);
  });

  it('returns the first outpost when the same id is created again', async () => {
    const fe = await newChat(t);
    const first = await outpost('Orders launch', [{ conversationId: fe, handle: 'fe' }]);

    const again = await createOutpost(t.db, {
      id: first.id,
      workspaceId: t.workspaceId,
      name: 'Another name',
      members: [{ conversationId: await newChat(t), handle: 'api' }],
    });

    expect(again).toEqual(first);
    expect(await listOutposts(t.db, t.workspaceId)).toHaveLength(1);
  });

  it('keeps an outpost inside its workspace', async () => {
    const created = await outpost();
    const other = randomUUID();
    await t.db.query(`INSERT INTO workspaces (id, slug, name) VALUES ($1, 'other', 'Other')`, [
      other,
    ]);

    expect(await getOutpost(t.db, other, created.id)).toBeNull();
    expect(await listOutposts(t.db, other)).toEqual([]);
    expect(await setName(t.db, other, created.id, 'Taken')).toBeNull();
    expect(await setPaused(t.db, other, created.id, true)).toBeNull();
    expect(await deleteOutpost(t.db, other, created.id)).toBe(false);
    expect(
      await refusal(
        createOutpost(t.db, { id: created.id, workspaceId: other, name: 'X', members: [] }),
      ),
    ).toEqual({ status: 409, message: OUTPOST_ID_IN_USE });
    expect((await getOutpost(t.db, t.workspaceId, created.id))?.name).toBe('Orders launch');
  });

  it('renames, pauses and resumes', async () => {
    const created = await outpost();

    expect((await setName(t.db, t.workspaceId, created.id, 'Checkout'))?.name).toBe('Checkout');
    const paused = await setPaused(t.db, t.workspaceId, created.id, true);
    expect(paused?.pausedAt).not.toBeNull();
    expect((await setPaused(t.db, t.workspaceId, created.id, true))?.pausedAt).toBe(
      paused?.pausedAt,
    );
    expect((await setPaused(t.db, t.workspaceId, created.id, false))?.pausedAt).toBeNull();
  });

  it('allows a chat in one outpost only', async () => {
    const fe = await newChat(t);
    const first = await outpost('First', [{ conversationId: fe, handle: 'fe' }]);
    const second = await outpost('Second');

    expect(
      await refusal(addMember(t.db, second.id, { conversationId: fe, handle: 'web' })),
    ).toEqual({
      status: 409,
      message: CHAT_ALREADY_IN_OUTPOST,
    });
    expect(await refusal(addMember(t.db, first.id, { conversationId: fe, handle: 'web' }))).toEqual(
      {
        status: 409,
        message: CHAT_ALREADY_IN_OUTPOST,
      },
    );
    expect((await outpostOf(t.db, fe))?.outpost.id).toBe(first.id);
  });

  it('keeps handles unique in an outpost and free across outposts', async () => {
    const first = await outpost('First', [{ conversationId: await newChat(t), handle: 'api' }]);
    const second = await outpost('Second');
    const late = await newChat(t);

    expect(
      await refusal(addMember(t.db, first.id, { conversationId: late, handle: 'api' })),
    ).toEqual({
      status: 409,
      message: '@api is already used in this outpost.',
    });
    expect((await addMember(t.db, second.id, { conversationId: late, handle: 'api' })).handle).toBe(
      'api',
    );
  });

  it('refuses the reserved handle, a malformed handle, an unknown chat and an unknown outpost', async () => {
    const created = await outpost();
    const chat = await newChat(t);

    expect(
      await refusal(addMember(t.db, created.id, { conversationId: chat, handle: 'all' })),
    ).toEqual({
      status: 400,
      message: '@all is reserved. Choose another handle.',
    });
    expect(
      await refusal(addMember(t.db, created.id, { conversationId: chat, handle: 'API' })),
    ).toEqual({
      status: 400,
      message: 'A handle starts with a lower-case letter.',
    });
    expect(
      (await refusal(addMember(t.db, created.id, { conversationId: randomUUID(), handle: 'api' })))
        .status,
    ).toBe(404);
    expect(
      (await refusal(addMember(t.db, randomUUID(), { conversationId: chat, handle: 'api' })))
        .status,
    ).toBe(404);
  });

  it('refuses a Terminal session as a member', async () => {
    const created = await outpost();
    const terminal = await newChat(t);
    await t.db.query(`UPDATE conversations SET session_type = 'terminal' WHERE id = $1`, [
      terminal,
    ]);

    expect(
      await refusal(addMember(t.db, created.id, { conversationId: terminal, handle: 'term' })),
    ).toEqual({ status: 409, message: TERMINAL_CANNOT_JOIN });
  });

  it('renames a handle and refuses one another member holds', async () => {
    const [fe, api] = [await newChat(t), await newChat(t)];
    const created = await outpost('Orders launch', [
      { conversationId: fe, handle: 'fe' },
      { conversationId: api, handle: 'api' },
    ]);

    expect(await renameHandle(t.db, created.id, fe, 'web')).toMatchObject({
      conversationId: fe,
      handle: 'web',
      position: 1,
    });
    expect((await refusal(renameHandle(t.db, created.id, fe, 'api'))).status).toBe(409);
    expect(await renameHandle(t.db, created.id, await newChat(t), 'docs')).toBeNull();
  });

  it('finds the outpost of a chat and nothing for a chat outside one', async () => {
    const fe = await newChat(t);
    const created = await outpost('Orders launch', [{ conversationId: fe, handle: 'fe' }]);

    expect(await outpostOf(t.db, fe)).toEqual({ outpost: created, member: created.members[0] });
    expect(await outpostOf(t.db, await newChat(t))).toBeNull();
  });

  it('removes a member and lets that chat join another outpost', async () => {
    const fe = await newChat(t);
    const first = await outpost('First', [{ conversationId: fe, handle: 'fe' }]);
    const second = await outpost('Second');

    expect(await removeMember(t.db, first.id, fe)).toBe(true);
    expect(await removeMember(t.db, first.id, fe)).toBe(false);
    expect((await addMember(t.db, second.id, { conversationId: fe, handle: 'fe' })).position).toBe(
      1,
    );
  });

  it('drops the member when its chat is deleted and the members when the outpost is deleted', async () => {
    const [fe, api] = [await newChat(t), await newChat(t)];
    const created = await outpost('Orders launch', [
      { conversationId: fe, handle: 'fe' },
      { conversationId: api, handle: 'api' },
    ]);

    await t.db.query('DELETE FROM conversations WHERE id = $1', [fe]);
    expect(
      (await getOutpost(t.db, t.workspaceId, created.id))?.members.map((m) => m.handle),
    ).toEqual(['api']);

    expect(await deleteOutpost(t.db, t.workspaceId, created.id)).toBe(true);
    expect(await outpostOf(t.db, api)).toBeNull();
    const kept = await t.db.query('SELECT 1 FROM conversations WHERE id = $1', [api]);
    expect(kept.rowCount).toBe(1);
  });
});

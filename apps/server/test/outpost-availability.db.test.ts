import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { outpostNeeds } from '../src/outposts/outpost-availability.ts';
import { createOutpostRow } from './outpost-fixtures.ts';
import {
  crewRun,
  linkProject,
  memberWithTurn,
  pieceRun,
  projectRow,
} from './outpost-tool-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

describe('which outpost tools a session is offered', () => {
  it('offers both groups to a top-level turn of a member chat', async () => {
    const web = await memberWithTurn(t, await createOutpostRow(t), 'web');
    expect(await outpostNeeds(t.db, web)).toEqual({ outpost: true, outpost_draft: true });
  });

  it('offers only the draft tool to a chat with a project that is in no outpost', async () => {
    const chat = await startChat(t, 'plan the checkout story');
    await linkProject(t, chat.conversationId, await projectRow(t, 'shop'));
    expect(await outpostNeeds(t.db, chat)).toEqual({ outpost: false, outpost_draft: true });
  });

  it('offers neither to a plain chat', async () => {
    const chat = await startChat(t, 'hello');
    expect(await outpostNeeds(t.db, chat)).toEqual({ outpost: false, outpost_draft: false });
  });

  it('offers neither to a piece of a member chat', async () => {
    const web = await memberWithTurn(t, await createOutpostRow(t), 'web');
    const runId = await pieceRun(t, web.runId);
    expect(await outpostNeeds(t.db, { conversationId: web.conversationId, runId })).toEqual({
      outpost: false,
      outpost_draft: false,
    });
  });

  it('offers both groups to a solo Builder and to the integrator of a crew turn', async () => {
    const web = await memberWithTurn(t, await createOutpostRow(t), 'web');
    for (const role of ['builder', 'integrator'] as const) {
      const runId = await crewRun(t, web.runId, role);
      expect(await outpostNeeds(t.db, { conversationId: web.conversationId, runId })).toEqual({
        outpost: true,
        outpost_draft: true,
      });
    }
  });

  it('offers the draft tool to the Builder of a chat with a project', async () => {
    const chat = await startChat(t, 'split this story into sub-chats');
    await linkProject(t, chat.conversationId, await projectRow(t, 'shop'));
    const runId = await crewRun(t, chat.runId, 'builder');
    expect(await outpostNeeds(t.db, { conversationId: chat.conversationId, runId })).toEqual({
      outpost: false,
      outpost_draft: true,
    });
  });

  it('offers neither to the Coordinator, a Critic or a research piece', async () => {
    const web = await memberWithTurn(t, await createOutpostRow(t), 'web');
    const others = [
      await crewRun(t, web.runId, 'coordinator'),
      await crewRun(t, web.runId, 'critic'),
      await crewRun(t, web.runId, 'scout', { pieceKey: 'P2' }),
    ];
    for (const runId of others) {
      expect(await outpostNeeds(t.db, { conversationId: web.conversationId, runId })).toEqual({
        outpost: false,
        outpost_draft: false,
      });
    }
  });

  it('offers neither to a Terminal session', async () => {
    const chat = await startChat(t, 'terminal');
    await linkProject(t, chat.conversationId, await projectRow(t, 'shop'));
    await t.db.query(`UPDATE conversations SET session_type = 'terminal' WHERE id = $1`, [
      chat.conversationId,
    ]);
    expect(await outpostNeeds(t.db, chat)).toEqual({ outpost: false, outpost_draft: false });
  });

  it('offers neither to a session with no chat or no turn', async () => {
    const web = await memberWithTurn(t, await createOutpostRow(t), 'web');
    const neither = { outpost: false, outpost_draft: false };
    expect(await outpostNeeds(t.db, { conversationId: null, runId: null })).toEqual(neither);
    expect(await outpostNeeds(t.db, { conversationId: web.conversationId, runId: null })).toEqual(
      neither,
    );
  });
});

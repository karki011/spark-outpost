import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { updateConversation } from '../src/persistence/conversation-actions.ts';
import { getConversationDetail, getSummary } from '../src/persistence/conversations.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { createTestDb, type TestDb } from './support.ts';
import { driveToEnd, openChat, sendMessage } from './turn-support.ts';
import { connectAgents, fakeAgents, startTurnWorker } from './turn-worker.ts';

let t: TestDb;
let base: string;
let worker: Worker;
let chats = 0;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-agent-title-')));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  await connectAgents(t);
  chats += 1;
  worker = startTurnWorker(t, {
    providers: fakeAgents({ sessions: path.join(base, `sessions-${chats}`) }),
  });
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
});

async function turn(conversationId: string, message: string): Promise<string> {
  const runId = await sendMessage(t, conversationId, message);
  const { run } = await driveToEnd(t, conversationId, runId);
  expect(run.status).toBe('succeeded');
  return runId;
}

const asking = (titles: unknown[]) =>
  `Look at the date divider #agenttitle ${JSON.stringify(titles)}`;

describe('the title an agent session reports', () => {
  it('names an automatically titled chat and survives a re-read', async () => {
    const conversationId = await openChat(t);
    await turn(conversationId, asking(['Fix the date divider']));

    expect(await getSummary(t.db, conversationId)).toMatchObject({
      title: 'Fix the date divider',
      titleSource: 'auto',
    });
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.conversation.title).toBe('Fix the date divider');
  });

  it('takes the last title the session reported in the turn', async () => {
    const conversationId = await openChat(t);
    await turn(conversationId, asking(['First guess', '', 'Fix the date divider']));
    expect((await getSummary(t.db, conversationId))?.title).toBe('Fix the date divider');
  });

  it('never replaces a name the user chose, before or during the turn', async () => {
    const conversationId = await openChat(t);
    await updateConversation(t.db, t.workspaceId, conversationId, { title: 'My name' });
    await turn(conversationId, asking(['Agent name']));
    expect(await getSummary(t.db, conversationId)).toMatchObject({
      title: 'My name',
      titleSource: 'user',
    });
  });

  it('keeps a name the user chose after an agent title named the chat', async () => {
    const conversationId = await openChat(t);
    await turn(conversationId, asking(['Agent name']));
    await updateConversation(t.db, t.workspaceId, conversationId, { title: 'My name' });
    await turn(conversationId, asking(['Another agent name']));
    expect(await getSummary(t.db, conversationId)).toMatchObject({
      title: 'My name',
      titleSource: 'user',
    });
  });

  it('ignores a title reported by a sub-agent session', async () => {
    const conversationId = await openChat(t);
    await turn(conversationId, 'Look at the routes #childtitle "Child session name"');
    expect((await getSummary(t.db, conversationId))?.title).not.toBe('Child session name');
  });

  it('flattens whitespace and control characters, and caps the length', async () => {
    const conversationId = await openChat(t);
    await turn(conversationId, asking(['  Fix\n the\u0007 date\t\tdivider ‮ ']));
    expect((await getSummary(t.db, conversationId))?.title).toBe('Fix the date divider');

    const long = `Rework ${'the date divider and its tests '.repeat(10)}`;
    const other = await openChat(t);
    await turn(other, asking([long]));
    const title = (await getSummary(t.db, other))!.title;
    expect(title.length).toBeLessThanOrEqual(100);
    expect(title).toMatch(/^Rework the date divider.*…$/);
  });

  it('ignores a title that is empty after cleaning', async () => {
    const conversationId = await openChat(t);
    await turn(conversationId, asking(['\n\u0007 \t']));
    expect(await getSummary(t.db, conversationId)).toMatchObject({ titleSource: 'message' });
  });
});

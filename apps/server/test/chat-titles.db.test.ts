import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { updateConversation } from '../src/persistence/conversation-actions.ts';
import {
  createConversation,
  getConversationDetail,
  getSummary,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { createFakeProvider, FAKE_TITLE } from '../src/providers/fake.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker;

beforeEach(async () => {
  t = await createTestDb();
  const provider = createFakeProvider({ stepMs: 0, wordMs: 0 });
  worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    concurrency: 1,
    pollMs: 20,
    cancelPollMs: 20,
  });
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
});

async function turn(conversationId: string, content: string) {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    { provider: 'fake' },
  );
  await eventually(async () => (await getRun(t.db, sent.run.id))?.finishedAt, 15_000);
}

async function newChat() {
  return (await createConversation(t.db, t.workspaceId, randomUUID())).id;
}

describe('the chat title', () => {
  it('takes the agent’s title line once and hides the line from the reply', async () => {
    const id = await newChat();
    await turn(id, '#title move the date helpers');
    const detail = await getConversationDetail(t.db, id);
    expect(detail?.conversation).toMatchObject({ title: FAKE_TITLE, titleSource: 'auto' });
    const reply = detail!.messages.find((message) => message.role === 'assistant')!;
    expect(reply.content).toContain('You wrote: "#title move the date helpers"');
    expect(reply.content).not.toMatch(/Title:/);

    await t.db.query(`UPDATE conversations SET title = 'Kept title' WHERE id = $1`, [id]);
    await turn(id, '#title one more thing');
    expect((await getSummary(t.db, id))?.title).toBe('Kept title');
  });

  it('stays as the user renamed it, until they resume auto titles', async () => {
    const id = await newChat();
    await turn(id, 'hello');
    const renamed = await updateConversation(t.db, t.workspaceId, id, { title: 'My name' });
    expect(renamed).toMatchObject({ title: 'My name', titleSource: 'user' });
    await turn(id, '#title add dark mode');
    expect(await getSummary(t.db, id)).toMatchObject({ title: 'My name', titleSource: 'user' });

    const resumed = await updateConversation(t.db, t.workspaceId, id, { autoTitle: true });
    expect(resumed).toMatchObject({ title: 'My name', titleSource: 'message' });
    await turn(id, '#title add dark mode');
    expect(await getSummary(t.db, id)).toMatchObject({ title: FAKE_TITLE, titleSource: 'auto' });
  });
});

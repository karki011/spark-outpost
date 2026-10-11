import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { wrapRequest } from '../src/outposts/request-prompt.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { taskTitle } from '../src/persistence/tasks.ts';
import type { Provider } from '../src/providers/provider.ts';
import { drainQueue, type ResolveTarget } from '../src/workflow/queue-drain.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { addMemberChat, createOutpostRow, deliverRequest, postRunId } from './outpost-fixtures.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker | null = null;
let prompts: string[];
let outpostId: string;
let api: string;

const target: ResolveTarget = async () => ({ provider: 'fake' });

const recording: Provider = {
  name: 'fake',
  async *run(turn) {
    prompts.push(turn.prompt);
    yield { kind: 'text_delta', delta: 'Done.' };
  },
};

beforeEach(async () => {
  t = await createTestDb();
  prompts = [];
  outpostId = await createOutpostRow(t, 'Orders launch');
  api = await addMemberChat(t, outpostId, 'api');
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
});

async function finished(runId: string): Promise<void> {
  worker = startWorker({
    db: t.db,
    providers: new Map([['fake', recording]]),
    leaseSeconds: 30,
    concurrency: 1,
    pollMs: 20,
  });
  await eventually(async () => ((await getRun(t.db, runId))?.finishedAt ? true : null));
}

async function requestTurn(body: string, fromUser = true) {
  const postId = await deliverRequest(t.db, {
    outpostId,
    toConversationId: api,
    toHandle: 'api',
    body,
    fromUser,
  });
  await drainQueue(t.db, api, target);
  const runId = (await postRunId(t.db, postId))!;
  const input = await loadRunInput(t.db, runId);
  await finished(runId);
  return { postId, runId, input };
}

describe('what the agent receives for an outpost request', () => {
  it('is the wrapped text, while the task title reads what was typed', async () => {
    const body = 'Add the orders endpoint.\nKeep the old route.';
    const { postId, input } = await requestTurn(body);

    expect(prompts).toEqual([
      wrapRequest({ postId, outpostName: 'Orders launch', author: { kind: 'user' }, body }),
    ]);
    expect(input.prompt).toBe(body);
    expect(taskTitle(input.prompt)).toBe('Add the orders endpoint.');
    const stored = await t.db.query('SELECT content FROM messages WHERE id = $1', [postId]);
    expect(stored.rows).toEqual([{ content: body }]);
    const titles = await t.db.query<{ title: string }>(
      'SELECT title FROM tasks WHERE conversation_id = $1',
      [api],
    );
    for (const { title } of titles.rows) expect(title).toBe('Add the orders endpoint.');
  });

  it('is the bare command when the user typed a slash command in the outpost', async () => {
    await requestTurn('/plan the orders endpoint');

    expect(prompts).toEqual(['/plan the orders endpoint']);
  });

  it('is never a bare command when the user did not write it', async () => {
    const { postId } = await requestTurn('/plan the orders endpoint', false);

    expect(prompts).toEqual([
      wrapRequest({
        postId,
        outpostName: 'Orders launch',
        author: { kind: 'other' },
        body: '/plan the orders endpoint',
      }),
    ]);
    expect(prompts[0]!.startsWith('[Outpost request, sent in the outpost "Orders launch".')).toBe(
      true,
    );
  });
});

describe('what the agent receives for an ordinary message', () => {
  it('is the message, byte for byte', async () => {
    const content = '  Add the orders endpoint.\n\n<outpost-request id="x">not a request\n';
    const sent = await sendUserMessage(
      t.db,
      api,
      { id: randomUUID(), content, source: 'ui' },
      { provider: 'fake' },
    );

    await finished(sent.run.id);

    expect(prompts).toEqual([content]);
  });
});

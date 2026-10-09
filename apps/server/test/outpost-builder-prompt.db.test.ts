import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { wrapRequest } from '../src/outposts/request-prompt.ts';
import { getRun } from '../src/persistence/runs.ts';
import type { Provider } from '../src/providers/provider.ts';
import { drainQueue, type ResolveTarget } from '../src/workflow/queue-drain.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { linkedConversation } from './approval-support.ts';
import { connectProviders, gitRepo, removeRepo } from './orchestration-support.ts';
import { createOutpostRow, deliverRequest, postRunId } from './outpost-fixtures.ts';
import { createTestDb, eventually, pinChatLevel, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let worker: Worker | null = null;
let prompts: string[];
let outpostId: string;
let api: string;

const target: ResolveTarget = async () => ({
  provider: 'claude',
  model: 'sonnet',
  effort: 'medium',
  permission: 'do',
  level: 'hands-off',
});

const recording: Provider = {
  name: 'claude',
  async *run(turn) {
    prompts.push(turn.prompt);
    yield { kind: 'text_delta', delta: 'Done.' };
  },
};

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  prompts = [];
  await connectProviders(t, false);
  outpostId = await createOutpostRow(t, 'Orders launch');
  api = (await linkedConversation(t, root)).conversationId;
  await pinChatLevel(t.db, api, 'hands-off');
  await t.db.query(
    `INSERT INTO outpost_members (outpost_id, conversation_id, handle, position)
     VALUES ($1, $2, 'api', 1)`,
    [outpostId, api],
  );
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
  await removeRepo(root);
});

async function buildTurn(body: string, fromUser: boolean): Promise<string> {
  const postId = await deliverRequest(t.db, {
    outpostId,
    toConversationId: api,
    toHandle: 'api',
    body,
    fromUser,
  });
  await drainQueue(t.db, api, target);
  const runId = (await postRunId(t.db, postId))!;
  worker = startWorker({
    db: t.db,
    providers: new Map([['claude', recording]]),
    leaseSeconds: 30,
    concurrency: 4,
    pollMs: 20,
    coordinator: 'off',
  });
  await eventually(async () => ((await getRun(t.db, runId))?.finishedAt ? true : null), 30_000);
  return postId;
}

describe('what a Builder receives for an outpost request', () => {
  it('is its brief with the request labelled once under Request', async () => {
    const body = 'Add a line saying hello to notes.txt.';
    const postId = await buildTurn(body, false);

    const brief = prompts.find((prompt) => prompt.startsWith('Role: Builder.'));
    const label = wrapRequest({
      postId,
      outpostName: 'Orders launch',
      author: { kind: 'other' },
      body,
    });
    expect(brief).toContain(`## Request\n${label}\n`);
    expect(brief!.split('<outpost-request ').length - 1).toBe(1);
    expect(brief!.replace(label, '')).not.toContain(body);
  });
});

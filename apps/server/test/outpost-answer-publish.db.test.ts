import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requestAnswer } from '../src/persistence/outpost-answers.ts';
import { getPost } from '../src/persistence/outpost-posts.ts';
import { drainQueue, type ResolveTarget } from '../src/workflow/queue-drain.ts';
import {
  addMemberChat,
  createOutpostRow,
  deliverRequest,
  finishRun,
  postRunId,
} from './outpost-fixtures.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

const target: ResolveTarget = async () => ({ provider: 'fake' });
const WORK = 'Added the endpoint and ran its tests.';
const PUBLISH = 'I could not open the pull request.\n\nNeeds you: run gh auth login';

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function startedRequest(): Promise<{ postId: string; runId: string }> {
  const outpostId = await createOutpostRow(t);
  const api = await addMemberChat(t, outpostId, 'api');
  const postId = await deliverRequest(t.db, { outpostId, toConversationId: api, toHandle: 'api' });
  expect(await drainQueue(t.db, api, target)).toBe('sent');
  return { postId, runId: (await postRunId(t.db, postId))! };
}

async function laterMessage(runId: string, content: string, finalReply: string | null = null) {
  await t.db.query(
    `INSERT INTO messages (id, conversation_id, role, content, run_id, final_reply, created_at)
     SELECT $2, conversation_id, 'assistant', $3, id, $4, now() + interval '1 second'
     FROM runs WHERE id = $1`,
    [runId, randomUUID(), content, finalReply],
  );
}

async function read(postId: string) {
  const request = (await getPost(t.db, postId))!;
  return { request, answer: await requestAnswer(t.db, t.workspaceId, request) };
}

describe('a request whose run also sent a publish prompt', () => {
  it('answers with the work reply, not the publish text', async () => {
    const { postId, runId } = await startedRequest();
    await finishRun(t.db, runId, 'succeeded', WORK);
    await laterMessage(runId, PUBLISH);

    const { request, answer } = await read(postId);

    expect(answer?.text).toBe(WORK);
    expect(request.facts?.runNeedsYou).toBeNull();
  });

  it('still needs the user when the work reply asks', async () => {
    const { postId, runId } = await startedRequest();
    await finishRun(t.db, runId, 'succeeded', 'Two shapes fit.\n\nNeeds you: pick v1 or v2.');
    await laterMessage(runId, 'Pushed the branch and opened the pull request.');

    const { request } = await read(postId);

    expect(request.facts?.runNeedsYou).toBe('Needs you: pick v1 or v2.');
  });

  it('reads the stored final reply of the work prompt', async () => {
    const { postId, runId } = await startedRequest();
    await t.db.query(
      `INSERT INTO messages (id, conversation_id, role, content, run_id, final_reply)
       SELECT $2, conversation_id, 'assistant', $3, id, $4 FROM runs WHERE id = $1`,
      [runId, randomUUID(), `Looking.\n\nNeeds you: nothing, a thought.\n\n${WORK}`, WORK],
    );
    await finishRun(t.db, runId, 'succeeded');
    await laterMessage(runId, PUBLISH, 'Needs you: run gh auth login');

    const { request, answer } = await read(postId);

    expect(answer?.text).toBe(WORK);
    expect(request.facts?.runNeedsYou).toBeNull();
  });
});

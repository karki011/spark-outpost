import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSummary, sendUserMessage } from '../src/persistence/conversations.ts';
import { requestExchanges } from '../src/persistence/outpost-exchanges.ts';
import { getPost } from '../src/persistence/outpost-posts.ts';
import { cancelPost } from '../src/persistence/outpost-tasks.ts';
import { shipTaskFacts } from '../src/ship/task-facts.ts';
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
let api: string;

const target: ResolveTarget = async () => ({ provider: 'fake' });
const ASKS = 'I found two shapes.\n\nNeeds you: pick v1 or v2.';
const WORK = 'Added the endpoint and ran its tests.';
const PUBLISHED = 'Pushed the branch and opened the pull request.';
const PUBLISH_ASKS = 'I could not open the pull request.\n\nNeeds you: run gh auth login';

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function twoReplies(work: string, publish: string) {
  const outpostId = await createOutpostRow(t);
  api = await addMemberChat(t, outpostId, 'api');
  const postId = await deliverRequest(t.db, { outpostId, toConversationId: api, toHandle: 'api' });
  expect(await drainQueue(t.db, api, target)).toBe('sent');
  const runId = (await postRunId(t.db, postId))!;
  await finishRun(t.db, runId, 'succeeded', work);
  await t.db.query(
    `INSERT INTO messages (id, conversation_id, role, content, run_id, created_at)
     SELECT $2, conversation_id, 'assistant', $3, id, now() + interval '1 second'
     FROM runs WHERE id = $1`,
    [runId, randomUUID(), publish],
  );
  return { postId, runId };
}

async function userAnswers(): Promise<string> {
  const message = { id: randomUUID(), content: 'Use v2.' };
  return (await sendUserMessage(t.db, api, message, { provider: 'fake' })).run.id;
}

describe('a run that stored a work reply and then a publish reply', () => {
  it('is continued by the user’s next turn when the work reply asked', async () => {
    const { postId } = await twoReplies(ASKS, PUBLISHED);

    const answer = await userAnswers();

    expect(await postRunId(t.db, postId)).toBe(answer);
  });

  it('is not continued because the publish reply asked', async () => {
    const { postId, runId } = await twoReplies(WORK, PUBLISH_ASKS);

    await userAnswers();

    expect(await postRunId(t.db, postId)).toBe(runId);
  });

  it('shows the work reply as the question the user answered', async () => {
    const { postId } = await twoReplies(ASKS, PUBLISHED);
    await userAnswers();

    const request = (await getPost(t.db, postId))!;

    expect(await requestExchanges(t.db, request.post)).toEqual([
      { question: ASKS, answer: 'Use v2.' },
    ]);
  });

  it('counts as finished, not as asking, when only the publish reply asked', async () => {
    const { postId } = await twoReplies(WORK, PUBLISH_ASKS);

    expect(await cancelPost(t.db, postId)).toEqual({ kind: 'finished' });
  });

  it('marks the chat as needing the user from the work reply alone', async () => {
    await twoReplies(WORK, PUBLISH_ASKS);
    expect((await getSummary(t.db, api))?.latestRun?.needsYou).toBeNull();

    await twoReplies(ASKS, PUBLISHED);
    expect((await getSummary(t.db, api))?.latestRun?.needsYou).toBe('Needs you: pick v1 or v2.');
  });

  it('gives the work reply as the summary for the pull request', async () => {
    const { runId } = await twoReplies(WORK, PUBLISHED);
    const taskId = randomUUID();
    await t.db.query('INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, $3)', [
      taskId,
      api,
      'Add the endpoint',
    ]);
    await t.db.query('UPDATE runs SET task_id = $2 WHERE id = $1', [runId, taskId]);

    expect((await shipTaskFacts(t.db, taskId)).summary).toBe(WORK);
  });
});

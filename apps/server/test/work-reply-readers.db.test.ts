import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createConversation,
  getSummary,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { shipTaskFacts } from '../src/ship/task-facts.ts';
import { finishTurn } from './chat-ask-fixtures.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let api: string;

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
  api = randomUUID();
  await createConversation(t.db, t.workspaceId, api);
  const message = { id: randomUUID(), content: 'Add the endpoint.' };
  const runId = (await sendUserMessage(t.db, api, message, { provider: 'fake' })).run.id;
  await finishTurn(t, runId, 'succeeded', work);
  await t.db.query(
    `INSERT INTO messages (id, conversation_id, role, content, run_id, created_at)
     SELECT $2, conversation_id, 'assistant', $3, id, now() + interval '1 second'
     FROM runs WHERE id = $1`,
    [runId, randomUUID(), publish],
  );
  return { runId };
}

describe('a run that stored a work reply and then a publish reply', () => {
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

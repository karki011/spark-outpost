import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunMode } from '@spark-outpost/contracts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { linkedConversation } from './approval-support.ts';
import {
  answerEverything,
  connectProviders,
  driveToEnd,
  gitRepo,
  removeRepo,
  startOrchestrator,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, eventually, type TestDb, underCurrent } from './support.ts';

let t: TestDb;
let root: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await connectProviders(t, false);
  harness = startOrchestrator(t, null);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

async function say(conversationId: string, content: string, permission: RunMode) {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    { provider: 'claude', model: 'sonnet', effort: 'medium', permission, level: 'hands-off' },
  );
  const runId = sent.run.id;
  if (permission === 'do') await driveToEnd(t, conversationId, runId, answerEverything);
  await eventually(async () => (await getRun(t.db, runId))?.finishedAt, 30_000);
  return runId;
}

async function crew(conversationId: string) {
  const { rows } = await t.db.query<{ role: string; model: string }>(
    `SELECT role, model FROM runs WHERE conversation_id = $1 AND role IS NOT NULL
     ORDER BY created_at`,
    [conversationId],
  );
  return rows.map((row) => [row.role, row.model]);
}

describe('the main chat session keeps one model in an Auto chat', { timeout: 90_000 }, () => {
  it.runIf(underCurrent)(
    'answers a trivial follow-up on the same model while the Builder is routed',
    async () => {
      const { conversationId } = await linkedConversation(t, root);
      await t.db.query(`UPDATE conversations SET model_routing = 'auto' WHERE id = $1`, [
        conversationId,
      ]);
      await say(conversationId, 'What does parseDate do?', 'ask');
      await say(conversationId, 'Fix the typo in the README heading. #build', 'do');
      await say(conversationId, 'Fix the typo?', 'ask');
      expect(await crew(conversationId)).toEqual([
        ['scout', 'opus[1m]'],
        ['builder', 'sonnet'],
        ['scout', 'opus[1m]'],
      ]);
    },
  );
});

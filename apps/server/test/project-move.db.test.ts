import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { expectConformantRun } from './agui-conformance.ts';
import { linkedConversation } from './approval-support.ts';
import {
  connectProviders,
  driveToEnd,
  gitRepo,
  removeRepo,
  startOrchestrator,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let harness: Harness;
let conversationId: string;

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  root = await gitRepo();
  await connectProviders(t, false);
  harness = startOrchestrator(t, null);
  conversationId = (await linkedConversation(t, root)).conversationId;
});

afterEach(async () => {
  await harness.stop();
  await t.cleanup();
  await removeRepo(root);
});

async function turn(content: string) {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    {
      provider: 'claude',
      model: 'sonnet',
      effort: 'medium',
      permission: 'do',
      agentMode: 'auto',
      level: 'hands-off',
    },
  );
  harness.worker.wake();
  await driveToEnd(t, conversationId, sent.run.id, undefined, 60_000);
  const { rows } = await t.db.query<{ roots: string[]; steps: string[]; prompts: string[] }>(
    `SELECT r.project_roots AS roots,
       ARRAY(SELECT e.payload->>'stepName' FROM run_events e
             WHERE e.run_id = r.id AND e.type = 'STEP_STARTED' ORDER BY e.seq) AS steps,
       ARRAY(SELECT c.prompt FROM runs c WHERE c.parent_run_id = r.id ORDER BY c.created_at) AS prompts
     FROM runs r WHERE r.id = $1`,
    [sent.run.id],
  );
  return { runId: sent.run.id, ...rows[0]! };
}

describe('the turn after a chat moves into its own worktree', { timeout: 120_000 }, () => {
  it('keeps the event order and does not call the worktree a changed project', async () => {
    const first = await turn('Add a line to notes.txt');
    expect(first.roots).toEqual([root]);
    const second = await turn('Add another line to notes.txt');
    expect(second.roots[0]).toContain(`${root}/.spark/worktrees/`);
    await expectConformantRun(t.db, first.runId);
    await expectConformantRun(t.db, second.runId);
    expect(second.steps.filter((step) => step.startsWith('Project changed'))).toEqual([]);
    expect(second.prompts.length).toBeGreaterThan(0);
    expect(second.prompts.join('\n')).not.toContain('project folder changed');
  });
});

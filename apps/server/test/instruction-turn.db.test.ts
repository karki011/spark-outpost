import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decideApproval } from '../src/persistence/approvals.ts';
import { getConversationDetail, sendUserMessage } from '../src/persistence/conversations.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
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
import { createTestDb, eventually, type TestDb } from './support.ts';

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

async function send(conversationId: string, content: string) {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    { provider: 'claude', model: 'sonnet', effort: 'medium', permission: 'do', level: 'hands-off' },
  );
  return sent.run.id;
}

async function finished(conversationId: string, runId: string) {
  return eventually(async () => {
    const detail = await getConversationDetail(t.db, conversationId);
    for (const approval of detail?.approvals ?? []) {
      const decision = approval.status === 'pending' ? answerEverything(approval) : null;
      if (decision)
        await decideApproval(t.db, t.workspaceId, approval.id, { scope: 'once', ...decision });
    }
    const run = await getRun(t.db, runId);
    return run?.finishedAt ? run : null;
  }, 60_000);
}

async function childRoles(runId: string) {
  const { rows } = await t.db.query<{ role: string }>(
    'SELECT role FROM runs WHERE parent_run_id = $1 ORDER BY created_at',
    [runId],
  );
  return rows.map((row) => row.role);
}

describe('a short instruction after finished work', { timeout: 120_000 }, () => {
  it('runs as the chat main agent instead of a new Orchestration with a Builder', async () => {
    const { conversationId } = await linkedConversation(t, root);
    const build = await send(conversationId, 'Fix the typo in the README heading. #build');
    await driveToEnd(t, conversationId, build, answerEverything);
    expect(await childRoles(build)).toContain('builder');

    const instruction = await send(conversationId, 'dont use spark to open pr');
    const run = await finished(conversationId, instruction);
    expect(run.status).toBe('succeeded');
    expect(await loadOrchestration(t.db, instruction)).toBeNull();
    expect(await childRoles(instruction)).toEqual([]);
  });

  it('still orchestrates a new build request that also asks for a PR', async () => {
    const { conversationId } = await linkedConversation(t, root);
    const build = await send(conversationId, 'Fix the typo in the README heading. #build');
    await driveToEnd(t, conversationId, build, answerEverything);

    const next = await send(conversationId, 'Add a CHANGELOG entry and open a PR. #build');
    const { orchestration } = await driveToEnd(t, conversationId, next, answerEverything);
    expect(orchestration).not.toBeNull();
    expect(await childRoles(next)).toContain('builder');
  });
});

import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { primaryChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { getConversationDetail, sendUserMessage } from '../src/persistence/conversations.ts';
import { taskChanges } from '../src/projects/task-changes.ts';
import { linkedConversation } from './approval-support.ts';
import {
  NORMAL,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, pinChatLevel, type TestDb } from './support.ts';

const REQUEST = 'Add CSV export #nativeplan #planbuilds';

let t: TestDb;
let root: string;
let harness: Harness;
let conversationId: string;

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  root = await gitRepo();
  await connectProviders(t);
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario: { ...NORMAL, review: 0.97 } }));
  conversationId = (await linkedConversation(t, root)).conversationId;
  await pinChatLevel(t.db, conversationId, 'full-auto');
});

afterEach(async () => {
  await harness.stop();
  await t.cleanup();
  await removeRepo(root);
});

async function planTurn(content: string, permission: 'ask' | 'do', agentMode: string) {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    {
      provider: 'claude',
      model: 'sonnet',
      effort: 'medium',
      permission,
      agentMode,
      level: 'full-auto',
    },
  );
  harness.worker.wake();
  await driveToEnd(
    t,
    conversationId,
    sent.run.id,
    (approval) => {
      const allow = approval.options.find((option) => option.kind === 'allow_once');
      return allow ? { optionId: allow.optionId } : null;
    },
    60_000,
  );
  const runs = await t.db.query<{ id: string; level: string | null; task_id: string }>(
    `SELECT id, level, task_id FROM runs WHERE conversation_id = $1 ORDER BY created_at`,
    [conversationId],
  );
  const detail = await getConversationDetail(t.db, conversationId);
  const copy = (await primaryChatWorktree(t.db, conversationId))!;
  return {
    runId: sent.run.id,
    runs: runs.rows,
    reply: detail?.messages.filter((message) => message.role === 'assistant').at(-1)?.content ?? '',
    crew: (await loadOrchestration(t.db, sent.run.id))?.crew ?? [],
    changes: await taskChanges(t.db, t.workspaceId, runs.rows[0]!.task_id),
    pending: execFileSync('git', ['-C', copy.path, 'status', '--porcelain']).toString(),
    committed: execFileSync('git', ['-C', copy.path, 'show', '--name-only', '--format=', 'HEAD'])
      .toString()
      .trim(),
  };
}

describe('a plan turn that a Critic reviews', { timeout: 120_000 }, () => {
  it('/plan lists its own change and commits it on the chat branch', async () => {
    const turn = await planTurn(`/plan ${REQUEST}`, 'do', 'auto');

    expect(turn.runs).toHaveLength(2);
    expect(turn.changes.runs).toEqual([
      expect.objectContaining({
        runId: turn.runId,
        files: [expect.objectContaining({ path: 'export.ts', change: 'added' })],
      }),
    ]);
    expect(turn.reply).toMatch(/Committed [0-9a-f]{7} on spark\/\S+, not pushed\./);
    expect(turn.committed).toBe('export.ts');
    expect(turn.pending).toBe('');
    expect(turn.crew.find((member) => member.runId === turn.runId)).toMatchObject({
      role: 'builder',
      model: 'sonnet',
      modelLabel: 'Sonnet 5',
    });
  });

  it('a build in a Plan-mode chat keeps the chat level and ships', async () => {
    const turn = await planTurn(REQUEST, 'ask', 'plan');

    expect(turn.runs[0]!.level).toBe('full-auto');
    expect(turn.reply).toMatch(/Committed [0-9a-f]{7} on spark\/\S+, not pushed\./);
    expect(turn.pending).toBe('');
  });
});

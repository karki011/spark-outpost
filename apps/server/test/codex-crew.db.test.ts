import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { modeForLegacy, type InvolvementLevel } from '@spark-outpost/contracts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { linkedConversation } from './approval-support.ts';
import {
  CODEX_MODELS,
  driveToEnd,
  gitRepo,
  removeRepo,
  startOrchestrator,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const EFFORTS = ['low', 'medium', 'high'].map((id) => ({ id, label: id, description: null }));

let t: TestDb;
let root: string;
let harness: Harness | null = null;

async function connectCodexOnly(): Promise<void> {
  await t.db.query(
    `INSERT INTO provider_connections
       (workspace_id, provider, method, detail, models, model, permission, effort, verified_at)
     VALUES ($1, 'codex', 'cli', 'test', '[]', 'gpt-6-sol', 'do', 'medium', now())`,
    [t.workspaceId],
  );
  await t.db.query(
    `INSERT INTO provider_capabilities (workspace_id, provider, models, efforts, default_model)
     VALUES ($1, 'codex', $2, $3, 'gpt-6-sol')`,
    [t.workspaceId, JSON.stringify(CODEX_MODELS), JSON.stringify(EFFORTS)],
  );
}

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await connectCodexOnly();
  harness = startOrchestrator(t, null);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

async function build(level: InvolvementLevel) {
  const { conversationId } = await linkedConversation(t, root);
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: 'Fix the typo in the README heading. #build' },
    {
      provider: 'codex',
      model: 'gpt-6-sol',
      effort: 'medium',
      permission: 'do',
      agentMode: modeForLegacy('codex', 'do', level),
      level,
    },
  );
  const result = await driveToEnd(t, conversationId, sent.run.id);
  const builders = await t.db.query<{ id: string; provider: string; in_copy: boolean }>(
    `SELECT r.id, r.provider,
            EXISTS (SELECT 1 FROM run_worktrees w WHERE w.run_id = r.id) AS in_copy
     FROM runs r
     WHERE (r.parent_run_id = $1 OR r.id = $1) AND r.role = 'builder'
     ORDER BY r.created_at`,
    [sent.run.id],
  );
  const copies = await t.db.query<{ merged: boolean; removed: boolean }>(
    `SELECT merged_at IS NOT NULL AS merged, removed_at IS NOT NULL AS removed
     FROM run_worktrees WHERE orchestration_run_id = $1`,
    [sent.run.id],
  );
  const status = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
  return { ...result, builders: builders.rows, copies: copies.rows, status };
}

describe('a Codex-only crew in Do', () => {
  it.each(['balanced'] as const)(
    'builds in place at %s and asks for the edit',
    async (level) => {
      const { orchestration, asked, builders, copies, status } = await build(level);
      expect(orchestration.status).toBe('succeeded');
      expect(builders.map((row) => [row.provider, row.in_copy])).toEqual([['codex', false]]);
      expect(copies).toEqual([]);
      expect(asked.some((approval) => approval.kind === 'edit')).toBe(true);
      expect(status).not.toBe('');
    },
    60_000,
  );

  it.each(['hands-off', 'full-auto'] as const)(
    'builds in a worktree at %s and merges it into the working tree',
    async (level) => {
      const { orchestration, asked, builders, copies, status } = await build(level);
      expect(orchestration.status).toBe('succeeded');
      expect(builders.map((row) => [row.provider, row.in_copy])).toEqual([['codex', true]]);
      expect(copies).toEqual([{ merged: true, removed: true }]);
      expect(asked.filter((approval) => approval.kind === 'edit')).toEqual([]);
      expect(status).not.toBe('');
      const listed = execFileSync('git', ['-C', root, 'worktree', 'list'], { encoding: 'utf8' });
      expect(listed).not.toContain('.spark');
    },
    60_000,
  );
});

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type InvolvementLevel } from '@spark-outpost/contracts';
import { decideApproval } from '../src/persistence/approvals.ts';
import { getConversationDetail, sendUserMessage } from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { saveConnection } from '../src/persistence/setup.ts';
import { createProviders } from '../src/workflow/providers.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { linkedConversation } from './approval-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const TASK =
  'Run `ls`, then read README.md with `cat README.md`, then add the line "Checked by Codex." at the end of README.md, then run `git status --short`. Keep the reply to one sentence.';

let t: TestDb;
let base: string;
let worker: Worker;

beforeAll(async () => {
  t = await createTestDb();
  const parent = process.env.SPARK_LIVE_DIR ?? tmpdir();
  await mkdir(parent, { recursive: true });
  base = await realpath(await mkdtemp(join(parent, 'spark-live-codex-do-')));
  await saveConnection(t.db, t.workspaceId, 'codex', {
    method: 'cli',
    detail: 'live',
    summary: '',
    models: [],
  });
  await t.db.query(
    `UPDATE provider_connections SET model = 'gpt-6-luna', effort = 'low'
     WHERE workspace_id = $1 AND provider = 'codex'`,
    [t.workspaceId],
  );
  worker = startWorker({
    db: t.db,
    providers: createProviders('acp'),
    leaseSeconds: 30,
    concurrency: 2,
    pollMs: 100,
    approvalPollMs: 200,
  });
});

afterAll(async () => {
  await worker.stop();
  await t.cleanup();
  await rm(base, { recursive: true, force: true });
});

async function repo(name: string): Promise<string> {
  const root = join(base, name);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'README.md'), '# Probe\n');
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args]);
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
  return root;
}

interface GateRow {
  run_id: string;
  tool_call_id: string;
  kind: string;
  title: string;
  decided_by: string | null;
}

async function toolCallIds(runIds: readonly string[]): Promise<Map<string, string>> {
  const { rows } = await t.db.query<{ id: string; kind: string | null }>(
    `SELECT DISTINCT payload->'params'->'update'->>'toolCallId' AS id,
            payload->'params'->'update'->>'kind' AS kind
     FROM run_protocol_log
     WHERE run_id = ANY($1::uuid[]) AND method = 'session/update'
       AND payload->'params'->'update'->>'sessionUpdate' = 'tool_call'`,
    [runIds],
  );
  return new Map(rows.map((row) => [row.id, row.kind ?? 'other']));
}

async function build(level: InvolvementLevel) {
  const root = await repo(level);
  const { conversationId } = await linkedConversation(t, root);
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: TASK },
    { provider: 'codex', model: 'gpt-6-luna', effort: 'low', permission: 'do', level },
  );
  const answered = new Set<string>();
  await eventually(async () => {
    const detail = await getConversationDetail(t.db, conversationId);
    for (const approval of detail?.approvals ?? []) {
      if (answered.has(approval.id)) continue;
      answered.add(approval.id);
      const optionId =
        approval.kind === 'accept'
          ? CHECKPOINT_OPTION.keep
          : approval.options.find((option) => option.kind === 'allow_once')?.optionId;
      if (optionId) {
        await decideApproval(t.db, t.workspaceId, approval.id, { optionId, scope: 'once' });
      }
    }
    const run = await getRun(t.db, sent.run.id);
    return run?.finishedAt ? run : null;
  }, 240_000);
  const { rows: runs } = await t.db.query<{ id: string; role: string | null }>(
    'SELECT id, role FROM runs WHERE id = $1 OR parent_run_id = $1',
    [sent.run.id],
  );
  const runIds = runs.map((row) => row.id);
  const { rows: gated } = await t.db.query<GateRow>(
    `SELECT run_id, tool_call_id, kind, title, decided_by FROM approvals
     WHERE run_id = ANY($1::uuid[]) AND kind IN ('edit', 'execute', 'other')
     ORDER BY created_at`,
    [runIds],
  );
  const { rows: copies } = await t.db.query<{ run_id: string }>(
    'SELECT run_id FROM run_worktrees WHERE orchestration_run_id = $1',
    [sent.run.id],
  );
  const { rows: usage } = await t.db.query<{ tokens: string | null; cost: string | null }>(
    `SELECT SUM(total_tokens)::text AS tokens, SUM(cost_usd)::text AS cost
     FROM runs WHERE id = ANY($1::uuid[])`,
    [runIds],
  );
  const run = await getRun(t.db, sent.run.id);
  const readme = execFileSync('git', ['-C', root, 'diff', '--', 'README.md'], { encoding: 'utf8' });
  return {
    status: run?.status,
    tools: await toolCallIds(runIds),
    gated,
    copies: copies.length,
    readme,
    usage: usage[0],
  };
}

describe('Codex Do, live (gpt-6-luna · low)', () => {
  it.each(['hands-on', 'balanced', 'hands-off', 'full-auto'] as const)(
    'sends every Codex action at %s to the gate',
    async (level) => {
      const result = await build(level);
      console.log(
        JSON.stringify({
          level,
          status: result.status,
          copies: result.copies,
          usage: result.usage,
          gated: result.gated.map((row) => `${row.kind}:${row.title} by ${row.decided_by}`),
          tools: [...result.tools.entries()],
        }),
      );
      expect(result.status).toBe('succeeded');
      const gatedIds = new Set(result.gated.map((row) => row.tool_call_id));
      for (const id of result.tools.keys()) expect(gatedIds.has(id)).toBe(true);
      expect(result.readme).toContain('Checked by Codex.');
      expect(result.copies).toBe(level === 'hands-off' || level === 'full-auto' ? 1 : 0);
      const byUser = result.gated.filter((row) => row.decided_by === 'user');
      if (level === 'hands-on') expect(byUser).toHaveLength(result.gated.length);
      if (level === 'balanced') {
        expect(result.gated.some((row) => row.decided_by === 'level')).toBe(true);
        expect(
          result.gated
            .filter((row) => row.kind === 'edit')
            .every((row) => row.decided_by === 'user'),
        ).toBe(true);
      }
    },
    300_000,
  );
});

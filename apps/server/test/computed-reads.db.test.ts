import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { SECRET_REASON } from '../src/approvals/decide.ts';
import { decideApproval } from '../src/persistence/approvals.ts';
import type { ProviderOutput } from '../src/providers/provider.ts';
import { createApprovalGate } from '../src/workflow/approval-gate.ts';
import { ApprovalWaiters } from '../src/workflow/approval-waiters.ts';
import { doRun, recordingAppend } from './approval-support.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const claude = createAcpProvider({ definition: agentDefinitions.claude, launch });

const DISGUISED = 'for f in $(ls -A | grep "^\\.e"); do head -c 200 "$f"; done';
const GLOBBED = 'head -c 200 .e*';

let t: TestDb;
let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-computed-reads-')));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'package.json'), '{}\n');
  await writeFile(join(root, 'src', 'a.ts'), 'export {};\n');
  await writeFile(join(root, '.env'), 'TOKEN=fake-value\n');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function pendingReasons(runId: string, count: number) {
  return eventually(async () => {
    const { rows } = await t.db.query<{ id: string; reason: string }>(
      `SELECT id, reason FROM approvals WHERE run_id = $1 AND status = 'pending'`,
      [runId],
    );
    return rows.length >= count ? rows : null;
  });
}

describe('Claude at Bypass permissions reading files it computes', { timeout: 30_000 }, () => {
  it('asks before a globbed secret read and leaves computed reads to the mode', async () => {
    const run = await doRun(t, root, 'go', 'full-auto');
    const waiters = new ApprovalWaiters();
    const gate = createApprovalGate({
      db: t.db,
      runId: run.runId,
      provider: 'claude',
      mode: 'bypassPermissions',
      append: recordingAppend().append,
      waiters,
      pollMs: 20,
      onTimeout: () => undefined,
      backup: async () => undefined,
    });
    const steps = ['cat package.json', DISGUISED, 'for f in src/*.ts; do cat "$f"; done', GLOBBED];
    const outputs: ProviderOutput[] = [];
    const turn = (async () => {
      for await (const output of claude.run({
        prompt: `#codex ${steps.join(';;')}`,
        history: [],
        settings: {
          method: 'cli',
          model: null,
          modelLabel: null,
          effort: null,
          mode: 'bypassPermissions',
        },
        projectRoots: [root],
        signal: new AbortController().signal,
        mode: 'do',
        worktree: true,
        approvals: gate,
      })) {
        outputs.push(output);
      }
    })();

    const [pending] = await pendingReasons(run.runId, 1);
    expect(pending!.reason).toBe(SECRET_REASON);
    await decideApproval(t.db, t.workspaceId, pending!.id, { optionId: 'decline', scope: 'once' });
    waiters.notify(pending!.id);
    await turn;

    const text = replyText(outputs);
    expect(text).toContain('[cat package.json=allow_once]');
    expect(text).toContain(`[${DISGUISED}=allow_once]`);
    expect(text).toContain('[for f in src/*.ts; do cat "$f"; done=allow_once]');
    expect(text).toContain(`[${GLOBBED}=decline]`);
    const { rows } = await t.db.query<{ title: string; status: string; decided_by: string }>(
      `SELECT title, status, decided_by FROM approvals WHERE run_id = $1 ORDER BY created_at`,
      [run.runId],
    );
    expect(rows.map((row) => [row.status, row.decided_by])).toEqual([
      ['allowed', 'level'],
      ['allowed', 'level'],
      ['allowed', 'level'],
      ['denied', 'user'],
    ]);
  });
});

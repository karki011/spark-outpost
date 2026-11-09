import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Approval, ApprovalScope } from '@spark-outpost/contracts';
import { decideApproval } from '../src/persistence/approvals.ts';
import { getConversationDetail, sendUserMessage } from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { saveConnection } from '../src/persistence/setup.ts';
import { revertRun, runChanges } from '../src/projects/run-changes.ts';
import { createProviders } from '../src/workflow/providers.ts';
import { startWorker } from '../src/workflow/worker.ts';
import { linkedConversation } from './approval-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let repo: string;

const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });

beforeAll(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-live-do-')));
  repo = join(base, 'repo');
  execFileSync('git', ['init', '-q', '--bare', join(base, 'remote.git')]);
  execFileSync('git', ['init', '-q', repo]);
  await writeFile(join(repo, 'README.md'), '# Live probe\n');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
  git('remote', 'add', 'origin', join(base, 'remote.git'));
});

afterAll(async () => {
  await t.cleanup();
  await rm(base, { recursive: true, force: true });
});

function answerFor(approval: Approval): { optionId: string; scope: ApprovalScope } {
  const allow = approval.options.find((option) => option.kind === 'allow_once')!;
  const reject = approval.options.find((option) => option.kind === 'reject_once')!;
  const command = approval.payload.command ?? '';
  if (/\bgit\b.*\bpush\b/.test(command)) return { optionId: reject.optionId, scope: 'once' };
  if (approval.kind === 'execute') return { optionId: allow.optionId, scope: 'run' };
  return { optionId: allow.optionId, scope: 'once' };
}

describe('live Claude Do run with approvals', () => {
  it('asks for an edit, ls, and git push, follows the answers, and reverts', async () => {
    await saveConnection(t.db, t.workspaceId, 'claude', {
      method: 'cli',
      detail: 'live',
      summary: '',
      models: [],
    });
    const { conversationId } = await linkedConversation(t, repo);
    const sent = await sendUserMessage(
      t.db,
      conversationId,
      {
        id: randomUUID(),
        content:
          'Do these steps in order, one tool call each: 1) Edit README.md so it ends with a new line `Edited by Spark`. 2) Run the shell command `ls`. 3) Run the shell command `git push origin HEAD`. If a step is denied, do not retry it or work around it. Then reply with one short line per step.',
      },
      {
        provider: 'claude',
        effort: 'low',
        permission: 'do',
        agentMode: 'default',
        level: 'hands-off',
      },
    );
    const worker = startWorker({
      db: t.db,
      providers: createProviders('acp'),
      leaseSeconds: 30,
      pollMs: 100,
      approvalPollMs: 200,
    });
    const answered: { approval: Approval; answer: ReturnType<typeof answerFor> }[] = [];
    try {
      for (let tick = 0; tick < 800; tick++) {
        const detail = await getConversationDetail(t.db, conversationId);
        const pending = (detail?.approvals ?? []).filter(
          (approval) => approval.status === 'pending',
        );
        for (const approval of pending) {
          const answer = answerFor(approval);
          await decideApproval(t.db, t.workspaceId, approval.id, answer);
          answered.push({ approval, answer });
        }
        const run = await getRun(t.db, sent.run.id);
        if (run?.finishedAt) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } finally {
      await worker.stop();
    }

    const run = await getRun(t.db, sent.run.id);
    const receipts = await t.db.query(
      `SELECT kind, title, payload->>'command' AS command, status, scope, decided_by, reason
       FROM approvals WHERE run_id = $1 ORDER BY created_at`,
      [sent.run.id],
    );
    const detail = await getConversationDetail(t.db, conversationId);
    console.log('live Do run', {
      status: run?.status,
      error: run?.error,
      receipts: receipts.rows,
      steps: detail?.activity[sent.run.id]?.map((step) => step.name),
      reply: detail?.messages.find((message) => message.role === 'assistant')?.content,
    });

    expect(run?.status).toBe('succeeded');
    const kinds = answered.map(({ approval }) => approval.kind);
    expect(kinds).toContain('edit');
    const push = receipts.rows.find((row) => /push/.test(row.command ?? ''));
    expect(push?.reason).toContain("this chat's own spark/ branch");
    expect(git('ls-remote', 'origin')).toBe('');
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toContain('Edited by Spark');

    const changes = await runChanges(t.db, t.workspaceId, sent.run.id);
    expect(changes.files).toContainEqual({ path: 'README.md', change: 'modified' });
    await revertRun(t.db, t.workspaceId, sent.run.id);
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('# Live probe\n');
    expect(git('status', '--porcelain')).toBe('');
  });
});

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { modeForLegacy, workflowTriggersSchema, type Approval } from '@spark-outpost/contracts';
import { cliSignedIn } from '../src/agents/acp/agent-cli.ts';
import { saveTriggers } from '../src/crew-flows/trigger-records.ts';
import { decideApproval } from '../src/persistence/approvals.ts';
import { setConversationProjects } from '../src/persistence/conversation-projects.ts';
import {
  createConversation,
  getConversationDetail,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { saveConnection } from '../src/persistence/setup.ts';
import { createProject } from '../src/projects/projects.ts';
import { createProviders } from '../src/workflow/providers.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import {
  newSpark,
  recordOf,
  saveFlow,
  statesOf,
  step,
  stepReply,
  useWorkflowsDir,
} from './crew-workflow-support.ts';
import { createTestDb, pinChatLevel, type TestDb } from './support.ts';

const MODEL = 'haiku';
const TURN_TIMEOUT_MS = 280_000;
const claudeReady = (await cliSignedIn('claude')) === true;

let t: TestDb;
let base: string;
let repo: string;
let projectId: string;
let worker: Worker | null = null;
let dropWorkflows: () => Promise<void>;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    encoding: 'utf8',
  });

beforeAll(async () => {
  if (!claudeReady) return;
  t = await createTestDb();
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-live-base-')));
  repo = join(base, 'repo');
  dropWorkflows = await useWorkflowsDir();
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  await writeFile(join(repo, 'README.md'), '# Base update probe\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'base');
  await saveConnection(t.db, t.workspaceId, 'claude', {
    method: 'cli',
    detail: 'live',
    summary: '',
    models: [],
  });
  projectId = (await createProject(t.db, t.workspaceId, repo)).project.id;
  await t.db.query("UPDATE projects SET work_place = 'worktree' WHERE id = $1", [projectId]);
  worker = startWorker({
    db: t.db,
    providers: createProviders('acp'),
    leaseSeconds: 30,
    pollMs: 100,
    approvalPollMs: 200,
  });
});

afterAll(async () => {
  if (!claudeReady) return;
  await worker?.stop();
  const spent = await t.db.query(
    'SELECT count(*)::int AS runs, sum(total_tokens)::int AS tokens, sum(cost_usd)::float AS usd FROM runs',
  );
  console.log('usage', JSON.stringify(spent.rows[0]));
  await dropWorkflows();
  await t.cleanup();
  await rm(base, { recursive: true, force: true });
});

async function driveToEnd(conversationId: string, runId: string) {
  const asked: Approval[] = [];
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const detail = await getConversationDetail(t.db, conversationId);
    for (const approval of detail?.approvals ?? []) {
      if (approval.status !== 'pending' || asked.some((seen) => seen.id === approval.id)) continue;
      asked.push(approval);
      const option = approval.options.find((candidate) => candidate.kind === 'allow_once')!;
      await decideApproval(t.db, t.workspaceId, approval.id, {
        optionId: option.optionId,
        scope: 'once',
      });
    }
    const run = await getRun(t.db, runId);
    if (run?.finishedAt) return asked;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Run ${runId} did not finish within ${TURN_TIMEOUT_MS} ms.`);
}

async function send(conversationId: string, content: string) {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    {
      provider: 'claude',
      model: MODEL,
      effort: 'low',
      permission: 'do',
      agentMode: modeForLegacy('claude', 'do', 'hands-off'),
      level: 'hands-off',
    },
  );
  const asked = await driveToEnd(conversationId, sent.run.id);
  return { runId: sent.run.id, asked, record: await recordOf(t, sent.run.id) };
}

async function refusals(runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{
    command: string | null;
    status: string;
    reason: string | null;
  }>(
    `SELECT a.payload->>'command' AS command, a.status, a.reason FROM approvals a
     JOIN runs r ON r.id = a.run_id WHERE r.parent_run_id = $1 ORDER BY a.created_at`,
    [runId],
  );
  return rows.map((row) => `${row.status} ${row.command}: ${row.reason}`);
}

async function worktreeOf(conversationId: string): Promise<string> {
  const { rows } = await t.db.query<{ path: string }>(
    'SELECT path FROM chat_worktrees WHERE conversation_id = $1 AND removed_at IS NULL',
    [conversationId],
  );
  return rows[0]!.path;
}

describe.skipIf(!claudeReady)('live Claude workflow step that updates its branch', () => {
  it(
    'merges main into a branch that fell behind, and merges instead of rebasing once pushed',
    { timeout: 900_000 },
    async () => {
      const tidy = await newSpark(t, 'Tidy', {
        provider: 'claude',
        model: MODEL,
        agentMode: 'bypassPermissions',
        instructions: 'You are Tidy. You keep a chat’s branch up to date with its base.\n',
      });
      await saveFlow(t, 'base-sync', [
        step('update', tidy.id, {
          prompt:
            'Bring main into this branch now, exactly as your access line says. Then run git log --oneline -3 and reply with its output and the commands you ran.',
        }),
      ]);
      await saveTriggers(t.db, t.workspaceId, 'base-sync', {
        ...workflowTriggersSchema.parse({}),
        updateBase: true,
      });
      const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
      await setConversationProjects(t.db, t.workspaceId, conversation.id, [projectId]);
      await pinChatLevel(t.db, conversation.id, 'hands-off');

      const first = await send(conversation.id, '@base-sync go');
      console.log('run 1', statesOf(first.record), await stepReply(t, first.record, 'update'));
      const worktree = await worktreeOf(conversation.id);
      const branch = git(worktree, 'branch', '--show-current').trim();
      console.log('worktree', worktree, branch);

      await writeFile(join(repo, 'upstream.txt'), 'landed on main\n');
      git(repo, 'add', 'upstream.txt');
      git(repo, 'commit', '-qm', 'upstream change');
      const mainHead = git(repo, 'rev-parse', 'main').trim();

      const second = await send(conversation.id, '@base-sync go');
      const reply2 = await stepReply(t, second.record, 'update');
      console.log('run 2', statesOf(second.record), reply2, await refusals(second.runId));
      console.log(
        'cards 2',
        second.asked.map((card) => card.payload.command),
      );
      expect(statesOf(second.record)).toEqual({ update: 'succeeded' });
      expect(git(worktree, 'merge-base', '--is-ancestor', mainHead, 'HEAD')).toBe('');
      expect(git(worktree, 'status', '--porcelain')).toBe('');

      execFileSync('git', ['init', '-q', '--bare', join(base, 'remote.git')]);
      git(repo, 'remote', 'add', 'origin', join(base, 'remote.git'));
      git(repo, 'push', '-q', 'origin', 'main', branch);
      git(worktree, 'fetch', '-q', 'origin');
      await writeFile(join(repo, 'second.txt'), 'another main change\n');
      git(repo, 'add', 'second.txt');
      git(repo, 'commit', '-qm', 'second upstream change');
      git(repo, 'push', '-q', 'origin', 'main');
      const secondHead = git(repo, 'rev-parse', 'main').trim();
      const pushedHead = git(worktree, 'rev-parse', 'HEAD').trim();

      await saveTriggers(t.db, t.workspaceId, 'base-pushed', {
        ...workflowTriggersSchema.parse({}),
        updateBase: true,
      });
      await saveFlow(t, 'base-pushed', [
        step('update', tidy.id, {
          prompt:
            'Run git rebase main first. If it is refused, follow what the refusal says to bring main in. Then reply with git log --oneline -3 and every command you ran with its result.',
        }),
      ]);
      const third = await send(conversation.id, '@base-pushed go');
      const reply3 = await stepReply(t, third.record, 'update');
      const refused3 = await refusals(third.runId);
      console.log('run 3', statesOf(third.record), reply3, refused3);
      expect(statesOf(third.record)).toEqual({ update: 'succeeded' });
      expect(refused3.some((line) => line.includes('rebase') && line.includes('force push'))).toBe(
        true,
      );
      expect(git(worktree, 'merge-base', '--is-ancestor', secondHead, 'HEAD')).toBe('');
      expect(git(worktree, 'merge-base', '--is-ancestor', pushedHead, 'HEAD')).toBe('');
    },
  );
});

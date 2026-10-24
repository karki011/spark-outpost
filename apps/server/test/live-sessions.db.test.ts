import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { decideApproval } from '../src/persistence/approvals.ts';
import { updateChatSettings } from '../src/persistence/chat-settings.ts';
import { insertChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { updateConversation, deleteConversation } from '../src/persistence/conversation-actions.ts';
import {
  createConversation,
  getConversationDetail,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { taskOverviews } from '../src/persistence/task-views.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { expectConformantRun } from './agui-conformance.ts';
import { linkedConversation } from './approval-support.ts';
import { FAKE_ACP_LAUNCH } from './fake-acp-support.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { methodLog, type MethodLog } from './live-session-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import { gitRepo, removeRepo } from './turn-support.ts';
import { connectAgents } from './turn-worker.ts';

const store = mkdtempSync(join(tmpdir(), 'live-sessions-db-'));
afterAll(() => rmSync(store, { recursive: true, force: true }));

const BRANCH = 'spark/later-1a2b3c4d';
const repo = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

const CLAUDE_MODES = [
  ['default', 'Manual', null, null],
  ['acceptEdits', 'Accept edits', null, null],
  ['plan', 'Plan', null, null],
  ['auto', 'Auto', null, null],
  ['bypassPermissions', 'Bypass permissions', null, null],
];

let t: TestDb;
let worker: Worker | null = null;
let log: MethodLog;

function begin(extraEnv: Record<string, string> = {}) {
  const provider = createAcpProvider({
    definition: { ...agentDefinitions.claude, name: 'Fake', ...FAKE_AGENT_MODES },
    launch: FAKE_ACP_LAUNCH,
    cancelGraceMs: 2_000,
    env: {
      ...childEnvironment(process.env),
      FAKE_ACP_SESSION_STORE: store,
      FAKE_ACP_SESSION_CAPABILITIES: JSON.stringify({ resume: {}, close: {} }),
      FAKE_ACP_METHOD_LOG: log.file,
      FAKE_ACP_BACKGROUND_MS: '1500',
      ...extraEnv,
    },
  });
  worker = startWorker({
    db: t.db,
    providers: new Map([['claude', provider]]),
    leaseSeconds: 30,
    pollMs: 20,
    cancelPollMs: 20,
    approvalPollMs: 20,
    recoveryEveryMs: 100,
  });
}

beforeEach(async () => {
  t = await createTestDb();
  await connectAgents(t);
  log = methodLog(store);
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
});

async function settled(runId: string) {
  return eventually(async () => {
    const run = await getRun(t.db, runId);
    return run?.finishedAt ? run : null;
  }, 20_000);
}

async function say(conversationId: string, content: string, agentMode: string | null = null) {
  if (agentMode) await updateChatSettings(t.db, conversationId, { agentMode, level: 'hands-off' });
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    agentMode
      ? { provider: 'claude', permission: 'do', agentMode, level: 'hands-off' }
      : { provider: 'claude' },
  );
  return settled(sent.run.id);
}

async function chat() {
  return (await createConversation(t.db, t.workspaceId, randomUUID())).id;
}

async function agentRun(conversationId: string) {
  return eventually(async () => {
    const detail = await getConversationDetail(t.db, conversationId);
    return detail?.runs.find((run) => run.agentCycle === true) ?? null;
  }, 20_000);
}

describe('one live agent session per chat', { timeout: 60_000 }, () => {
  it('keeps the agent process across messages and resumes after a restart', async () => {
    begin();
    const conversationId = await chat();
    for (const message of ['one', 'two', 'three']) {
      expect((await say(conversationId, message)).status).toBe('succeeded');
    }
    expect(log.count('initialize')).toBe(1);
    expect(log.count('session/prompt')).toBe(3);

    await worker?.stop();
    expect(log.count('session/close')).toBe(1);
    begin();
    expect((await say(conversationId, 'four')).status).toBe('succeeded');

    expect(log.count('session/resume')).toBe(1);
    expect(log.count('initialize')).toBe(2);
  });

  it('records the agent continuing on its own as a run of its own', async () => {
    begin();
    const conversationId = await chat();
    const first = await say(conversationId, '#later');
    expect(first.status).toBe('succeeded');

    const continued = await agentRun(conversationId);
    const finished = await settled(continued.id);

    expect(finished.status).toBe('succeeded');
    expect(continued.userMessageId).toBeNull();
    await expectConformantRun(t.db, continued.id);
    const detail = await getConversationDetail(t.db, conversationId);
    const reply = detail?.messages.find((message) => message.runId === continued.id);
    expect(reply?.content).toBe('Woke up on my own: checked.');
    expect(log.count('session/prompt')).toBe(1);
  });

  it('asks on a card in the agent’s own turn for a request that came between turns, and counts that turn in the task', async () => {
    begin();
    const root = await realpath(mkdtempSync(join(store, 'project-')));
    const { conversationId } = await linkedConversation(t, root);
    expect((await say(conversationId, '#laterask', 'default')).status).toBe('succeeded');

    const continued = await agentRun(conversationId);
    const approval = await eventually(async () => {
      const { rows } = await t.db.query<{ id: string }>(
        `SELECT id FROM approvals WHERE run_id = $1 AND status = 'pending'`,
        [continued.id],
      );
      return rows[0] ?? null;
    }, 20_000);
    await decideApproval(t.db, t.workspaceId, approval.id, { optionId: 'yes', scope: 'once' });

    expect((await settled(continued.id)).status).toBe('succeeded');
    const detail = await getConversationDetail(t.db, conversationId);
    const reply = detail?.messages.find((message) => message.runId === continued.id);
    expect(reply?.content).toBe('Woke up on my own: yes.');
    const [task] = await taskOverviews(t.db, conversationId);
    expect(task?.runIds).toContain(continued.id);
  });

  it('judges a request between turns under the mode the chat has now', async () => {
    begin();
    const root = await realpath(mkdtempSync(join(store, 'project-')));
    const { conversationId } = await linkedConversation(t, root);
    expect((await say(conversationId, '#laterask', 'acceptEdits')).status).toBe('succeeded');
    await updateChatSettings(t.db, conversationId, { agentMode: 'default' });

    const continued = await agentRun(conversationId);
    const approval = await eventually(async () => {
      const { rows } = await t.db.query<{ id: string }>(
        `SELECT id FROM approvals WHERE run_id = $1 AND status = 'pending'`,
        [continued.id],
      );
      return rows[0] ?? null;
    }, 20_000);
    await decideApproval(t.db, t.workspaceId, approval.id, { optionId: 'no', scope: 'once' });

    expect((await settled(continued.id)).status).toBe('succeeded');
  });

  it('finishes the agent’s own turn and its publish prompt after it changed files', async () => {
    begin();
    const root = await gitRepo();
    const remote = await realpath(mkdtempSync(join(store, 'remote-')));
    try {
      repo(remote, 'init', '-q', '--bare');
      repo(root, 'remote', 'add', 'origin', remote);
      repo(root, 'checkout', '-qb', BRANCH);
      const { conversationId, projectId } = await linkedConversation(t, root);
      await insertChatWorktree(t.db, {
        id: randomUUID(),
        conversationId,
        projectId,
        repoRoot: root,
        path: root,
        branch: BRANCH,
        baseBranch: 'main',
        baseCommit: 'a'.repeat(40),
        landedCommit: null,
        inPlace: false,
        ownsBranch: true,
      });
      await updateChatSettings(t.db, conversationId, { level: 'full-auto' });
      const sent = await sendUserMessage(
        t.db,
        conversationId,
        { id: randomUUID(), content: '#laterwrite' },
        {
          provider: 'claude',
          permission: 'do',
          agentMode: 'bypassPermissions',
          level: 'full-auto',
        },
      );
      expect((await settled(sent.run.id)).status).toBe('succeeded');

      const continued = await agentRun(conversationId);

      expect((await settled(continued.id)).status).toBe('succeeded');
      expect(log.count('session/prompt')).toBe(2);
    } finally {
      await removeRepo(root);
    }
  });

  it('allows a sub-agent’s requests in Auto at once, as it does the main agent’s', async () => {
    begin({ FAKE_ACP_MODES: JSON.stringify(CLAUDE_MODES) });
    const root = await realpath(mkdtempSync(join(store, 'project-')));
    const { conversationId } = await linkedConversation(t, root);

    const run = await say(conversationId, '#subagentsask', 'auto');

    expect(run.status).toBe('succeeded');
    const { rows } = await t.db.query<{ status: string }>(
      'SELECT status FROM approvals WHERE run_id = $1',
      [run.id],
    );
    expect(rows.filter((row) => row.status === 'pending')).toEqual([]);
    expect(rows).toContainEqual({ status: 'allowed' });
    const steps = await t.db.query<{ name: string }>(
      `SELECT payload->>'stepName' AS name FROM run_events
       WHERE run_id = $1 AND type = 'STEP_STARTED'`,
      [run.id],
    );
    expect(steps.rows.map((row) => row.name)).not.toContainEqual(
      expect.stringMatching(/^Allowed /),
    );
  });

  it('closes the live session when the chat is archived', async () => {
    begin();
    const conversationId = await chat();
    await say(conversationId, 'hello');

    await updateConversation(t.db, t.workspaceId, conversationId, { archived: true });

    await eventually(async () => log.count('session/close') === 1 || null, 20_000);
  });

  it('closes the live session when the chat is deleted', async () => {
    begin();
    const conversationId = await chat();
    await say(conversationId, 'hello');

    await deleteConversation(t.db, t.workspaceId, conversationId);

    await eventually(async () => log.count('session/close') === 1 || null, 20_000);
  });
});

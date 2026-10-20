import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { decideApproval } from '../src/persistence/approvals.ts';
import { updateConversation, deleteConversation } from '../src/persistence/conversation-actions.ts';
import {
  createConversation,
  getConversationDetail,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { expectConformantRun } from './agui-conformance.ts';
import { linkedConversation } from './approval-support.ts';
import { FAKE_ACP_LAUNCH } from './fake-acp-support.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { methodLog, type MethodLog } from './live-session-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const store = mkdtempSync(join(tmpdir(), 'live-sessions-db-'));
afterAll(() => rmSync(store, { recursive: true, force: true }));

let t: TestDb;
let worker: Worker | null = null;
let log: MethodLog;

function begin() {
  const provider = createAcpProvider({
    definition: { ...agentDefinitions.claude, name: 'Fake', ...FAKE_AGENT_MODES },
    launch: FAKE_ACP_LAUNCH,
    cancelGraceMs: 2_000,
    env: {
      ...childEnvironment(process.env),
      FAKE_ACP_SESSION_STORE: store,
      FAKE_ACP_SESSION_CAPABILITIES: JSON.stringify({ resume: {}, close: {} }),
      FAKE_ACP_METHOD_LOG: log.file,
      FAKE_ACP_BACKGROUND_MS: '300',
    },
  });
  worker = startWorker({
    db: t.db,
    providers: new Map([['claude', provider]]),
    leaseSeconds: 30,
    concurrency: 2,
    pollMs: 20,
    cancelPollMs: 20,
    approvalPollMs: 20,
    recoveryEveryMs: 100,
  });
}

beforeEach(async () => {
  t = await createTestDb();
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

  it('asks on a card in the agent’s own turn for a request that came between turns', async () => {
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

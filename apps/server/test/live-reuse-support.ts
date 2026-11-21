import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { insertChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { updateChatSettings } from '../src/persistence/chat-settings.ts';
import { getRun } from '../src/persistence/runs.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { startSparkMcpHost, type SparkMcpHost } from '../src/spark-mcp/host.ts';
import { deliverAsk } from '../src/sub-chats/deliver-ask.ts';
import { chatTarget } from '../src/workflow/queue-drain.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { linkedConversation } from './approval-support.ts';
import { FAKE_ACP_LAUNCH } from './fake-acp-support.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { methodLog, type MethodLog } from './live-session-support.ts';
import { messageAsk, turnsOf } from './chat-ask-fixtures.ts';
import { toolDeps } from './spark-mcp-support.ts';
import { emptyChat } from './sub-chat-fixtures.ts';
import { eventually, type TestDb } from './support.ts';
import { gitRepo } from './turn-support.ts';

export type TurnKind = 'user' | 'round' | 'chat' | 'push';

export interface TurnMeasure {
  kind: TurnKind;
  reused: boolean;
  firstEventMs: number;
  doneMs: number;
}

const BRANCH = 'spark/reuse-1a2b3c4d';
export type Level = 'hands-off' | 'full-auto';

const targetAt = (level: Level) =>
  ({ provider: 'claude', permission: 'do', agentMode: 'default', level }) as const;

const MESSAGES: Record<Exclude<TurnKind, 'chat'>, string> = {
  user: 'next',
  round: 'Fix the failing check',
  push: 'push it',
};

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

export interface ReuseHarness {
  log: MethodLog;
  chat(level: Level): Promise<string>;
  run(conversationId: string, kind: TurnKind, level: Level): Promise<TurnMeasure>;
  stop(): Promise<void>;
}

export async function startReuseHarness(t: TestDb, store: string): Promise<ReuseHarness> {
  const log = methodLog(store);
  const host: SparkMcpHost = await startSparkMcpHost(toolDeps(t));
  const provider = createAcpProvider({
    definition: { ...agentDefinitions.claude, name: 'Fake', ...FAKE_AGENT_MODES },
    launch: FAKE_ACP_LAUNCH,
    cancelGraceMs: 2_000,
    sparkTools: host,
    env: {
      ...childEnvironment(process.env),
      FAKE_ACP_SESSION_STORE: store,
      FAKE_ACP_SESSION_CAPABILITIES: JSON.stringify({ resume: {}, close: {} }),
      FAKE_ACP_METHOD_LOG: log.file,
    },
  });
  const worker: Worker = startWorker({
    db: t.db,
    providers: new Map([['claude', provider]]),
    leaseSeconds: 30,
    pollMs: 20,
    cancelPollMs: 20,
    approvalPollMs: 20,
    recoveryEveryMs: 1_000,
  });
  const sender = { id: await emptyChat(t, 'Orders page'), title: 'Orders page' };

  const chat = async (level: Level) => {
    const root = await gitRepo();
    const remote = await realpath(mkdtempSync(join(store, 'remote-')));
    git(remote, 'init', '-q', '--bare');
    git(root, 'remote', 'add', 'origin', remote);
    git(root, 'checkout', '-qb', BRANCH);
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
    await updateChatSettings(t.db, conversationId, { agentMode: 'default', level });
    return conversationId;
  };

  const startRequest = async (conversationId: string): Promise<string> => {
    const askId = await messageAsk(
      t,
      sender,
      conversationId,
      'What does the orders endpoint return?',
    );
    await deliverAsk(t.db, askId, chatTarget(t.db));
    const turn = await eventually(async () =>
      (await turnsOf(t, conversationId)).find((started) => started.user_message_id === askId),
    );
    return turn.id;
  };

  const start = async (conversationId: string, kind: TurnKind, level: Level): Promise<string> => {
    if (kind === 'chat') return startRequest(conversationId);
    const sent = await sendUserMessage(
      t.db,
      conversationId,
      {
        id: randomUUID(),
        content: MESSAGES[kind],
        ...(kind === 'round' ? { source: 'pr_follow_up' as const } : {}),
      },
      targetAt(level),
    );
    return sent.run.id;
  };

  const opens = () =>
    log.count('initialize') + log.count('session/new') + log.count('session/resume');

  return {
    log,
    chat,
    async run(conversationId, kind, level) {
      const before = opens();
      const began = Date.now();
      const runId = await start(conversationId, kind, level);
      await eventually(async () => {
        const { rows } = await t.db.query(
          `SELECT 1 FROM run_events WHERE run_id = $1 AND type LIKE 'TEXT_MESSAGE%' LIMIT 1`,
          [runId],
        );
        return rows.length > 0;
      }, 30_000);
      const firstEventMs = Date.now() - began;
      await eventually(async () => (await getRun(t.db, runId))?.finishedAt, 30_000);
      const doneMs = Date.now() - began;
      return { kind, reused: opens() === before, firstEventMs, doneMs };
    },
    async stop() {
      await worker.stop();
      await host.close();
    },
  };
}

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAcpProvider } from '../../apps/server/src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../../apps/server/src/agents/acp/agents.ts';
import { updateChatSettings } from '../../apps/server/src/persistence/chat-settings.ts';
import { sendUserMessage } from '../../apps/server/src/persistence/conversations.ts';
import {
  listen,
  type NotificationListener,
} from '../../apps/server/src/persistence/notifications.ts';
import { childEnvironment } from '../../apps/server/src/setup/environment.ts';
import { startSparkMcpHost, type SparkMcpHost } from '../../apps/server/src/spark-mcp/host.ts';
import { startWorker, type Worker } from '../../apps/server/src/workflow/worker.ts';
import { linkedConversation } from '../../apps/server/test/approval-support.ts';
import { FAKE_ACP_LAUNCH } from '../../apps/server/test/fake-acp-support.ts';
import { FAKE_AGENT_MODES } from '../../apps/server/test/fake-agent-modes.ts';
import { methodLog, type MethodLog } from '../../apps/server/test/live-session-support.ts';
import { toolDeps } from '../../apps/server/test/spark-mcp-support.ts';
import {
  createTestDb,
  dropSpareSchemas,
  testDatabaseUrl,
  type TestDb,
} from '../../apps/server/test/support.ts';
import { connectAgents } from '../../apps/server/test/turn-worker.ts';
import { gitRepo, removeRepo } from '../../apps/server/test/turn-support.ts';
import { newTurnWatch, type TurnTimes, type TurnWatch } from './turn-clock.ts';

const TURN_TIMEOUT_MS = 60_000;
const TARGET = {
  provider: 'claude',
  permission: 'do',
  agentMode: 'default',
  level: 'full-auto',
} as const;

export interface TurnMeasure extends TurnTimes {
  reused: boolean;
}

export interface BenchSession {
  t: TestDb;
  chat(): Promise<string>;
  turn(conversationId: string, content: string): Promise<TurnMeasure>;
  stop(): Promise<void>;
}

export async function startBenchSession(): Promise<BenchSession> {
  const t = await createTestDb();
  await connectAgents(t);
  const store = mkdtempSync(join(tmpdir(), 'turn-bench-'));
  const roots: string[] = [];
  const log: MethodLog = methodLog(store);
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
  let active: TurnWatch | null = null;
  const listener: NotificationListener = await listen(testDatabaseUrl(), 'run_events', (runId) =>
    active?.notified(runId),
  );
  const opens = () =>
    log.count('initialize') + log.count('session/new') + log.count('session/resume');

  return {
    t,
    async chat() {
      const root = await gitRepo();
      roots.push(root);
      const { conversationId } = await linkedConversation(t, root);
      await updateChatSettings(t.db, conversationId, { agentMode: 'default', level: 'full-auto' });
      return conversationId;
    },
    async turn(conversationId, content) {
      const before = opens();
      const watch = newTurnWatch(t.db);
      active = watch;
      const sent = await sendUserMessage(
        t.db,
        conversationId,
        { id: randomUUID(), content },
        TARGET,
      );
      watch.start(sent.run.id);
      const times = await watch.result(TURN_TIMEOUT_MS);
      active = null;
      return { ...times, reused: opens() === before };
    },
    async stop() {
      await worker.stop();
      await host.close();
      await listener.close();
      await t.cleanup();
      await dropSpareSchemas();
      rmSync(store, { recursive: true, force: true });
      await Promise.all(roots.map(removeRepo));
    },
  };
}

import type { ProviderId } from '@spark-outpost/contracts';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import type { Provider } from '../src/providers/provider.ts';
import { startWorker, type RunTurn, type Worker } from '../src/workflow/worker.ts';
import { FAKE_ACP_LAUNCH } from './fake-acp-support.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import type { TestDb } from './support.ts';

type FakeAgentId = Extract<ProviderId, 'claude' | 'codex'>;

interface AgentModel {
  id: string;
  label: string;
  description: string;
}

export const AGENT_MODELS: Readonly<Record<FakeAgentId, readonly AgentModel[]>> = {
  claude: [
    { id: 'haiku', label: 'Haiku 4.5', description: 'Fastest for quick answers' },
    { id: 'sonnet', label: 'Sonnet 5', description: 'Efficient for routine tasks' },
    { id: 'opus[1m]', label: 'Opus 5.5', description: 'Best for complex tasks' },
  ],
  codex: [
    { id: 'gpt-6-astra', label: '6 Astra', description: 'Frontier' },
    { id: 'gpt-6-sol', label: '6 Sol', description: 'Workhorse' },
    { id: 'gpt-6-luna', label: '6 Luna', description: 'Fast' },
  ],
};

export const DEFAULT_MODEL: Readonly<Record<FakeAgentId, string>> = {
  claude: 'sonnet',
  codex: 'gpt-6-sol',
};

const AGENT_IDS: readonly FakeAgentId[] = ['claude', 'codex'];

const EFFORTS = ['low', 'medium', 'high'].map((id) => ({ id, label: id, description: null }));

export async function connectAgents(t: TestDb): Promise<void> {
  for (const provider of AGENT_IDS) {
    const model = DEFAULT_MODEL[provider];
    await t.db.query(
      `INSERT INTO provider_connections
         (workspace_id, provider, method, detail, models, model, permission, effort, verified_at)
       VALUES ($1, $2, 'cli', 'test', '[]', $3, 'ask', 'medium', now())`,
      [t.workspaceId, provider, model],
    );
    await t.db.query(
      `INSERT INTO provider_capabilities (workspace_id, provider, models, efforts, default_model)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        t.workspaceId,
        provider,
        JSON.stringify(AGENT_MODELS[provider]),
        JSON.stringify(EFFORTS),
        model,
      ],
    );
  }
}

export interface FakeAgentOptions {
  sessions?: string;
  agentEnv?: Record<string, string>;
}

function sessionEnv(store: string | undefined): Record<string, string> {
  if (!store) return {};
  return {
    FAKE_ACP_SESSION_STORE: store,
    FAKE_ACP_SESSION_CAPABILITIES: JSON.stringify({ resume: {}, close: {} }),
  };
}

function fakeAgent(id: FakeAgentId, options: FakeAgentOptions): Provider {
  const { conversationMode, askMode } = FAKE_AGENT_MODES;
  return createAcpProvider({
    definition: { ...agentDefinitions[id], conversationMode, askMode },
    launch: FAKE_ACP_LAUNCH,
    cancelGraceMs: 2_000,
    env: {
      ...(process.env as Record<string, string>),
      FAKE_ACP_PROVIDER: id,
      FAKE_ACP_MODELS: JSON.stringify(AGENT_MODELS[id].map((model) => [model.id, model.label])),
      ...sessionEnv(options.sessions),
      ...options.agentEnv,
    },
  });
}

export function fakeAgents(options: FakeAgentOptions = {}): Map<string, Provider> {
  return new Map(AGENT_IDS.map((id) => [id, fakeAgent(id, options)]));
}

export interface TurnWorkerOptions extends FakeAgentOptions {
  runTurn?: RunTurn;
  providers?: ReadonlyMap<string, Provider>;
  concurrency?: number;
  cancelPollMs?: number;
}

export function startTurnWorker(t: TestDb, options: TurnWorkerOptions = {}): Worker {
  return startWorker({
    db: t.db,
    providers: options.providers ?? fakeAgents(options),
    leaseSeconds: 30,
    concurrency: options.concurrency ?? 8,
    pollMs: 20,
    cancelPollMs: options.cancelPollMs ?? 20,
    approvalPollMs: 20,
    ...(options.runTurn ? { runTurn: options.runTurn } : {}),
  });
}

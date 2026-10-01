import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InvolvementLevel } from '@spark-outpost/contracts';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { updateChatSettings } from '../src/persistence/chat-settings.ts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import type { Provider } from '../src/providers/provider.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { FAKE_ACP_LAUNCH } from './fake-acp-support.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { CLAUDE_MODELS, connectProviders } from './orchestration-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

export const CONTEXT_SIZE = 200_000;

const TARGET = {
  provider: 'claude',
  model: 'sonnet',
  effort: 'medium',
  permission: 'ask',
} as const;

export interface CompactionHarness {
  t: TestDb;
  worker: Worker;
  store: string;
  stop(): Promise<void>;
}

function fakeClaude(store: string, commands: readonly string[]): Provider {
  return createAcpProvider({
    definition: { ...agentDefinitions.claude, ...FAKE_AGENT_MODES },
    launch: FAKE_ACP_LAUNCH,
    cancelGraceMs: 2_000,
    env: {
      ...(process.env as Record<string, string>),
      FAKE_ACP_MODELS: JSON.stringify(CLAUDE_MODELS.map((model) => [model.id, model.label])),
      FAKE_ACP_SESSION_STORE: store,
      FAKE_ACP_SESSION_CAPABILITIES: JSON.stringify({ resume: {}, close: {} }),
      FAKE_ACP_COMMANDS: JSON.stringify(commands),
      FAKE_ACP_CONTEXT_SIZE: String(CONTEXT_SIZE),
    },
  });
}

export async function startCompactionHarness(
  commands: readonly string[] = ['compact'],
): Promise<CompactionHarness> {
  const t = await createTestDb();
  const store = mkdtempSync(join(tmpdir(), 'fake-acp-compact-'));
  await connectProviders(t, false);
  const worker = startWorker({
    db: t.db,
    providers: new Map([['claude', fakeClaude(store, commands)]]),
    leaseSeconds: 30,
    concurrency: 2,
    pollMs: 20,
    cancelPollMs: 20,
    approvalPollMs: 20,
  });
  return {
    t,
    worker,
    store,
    async stop() {
      await worker.stop();
      await t.cleanup();
      rmSync(store, { recursive: true, force: true });
    },
  };
}

export async function newChat(h: CompactionHarness, level: InvolvementLevel): Promise<string> {
  const { id } = await createConversation(h.t.db, h.t.workspaceId, randomUUID());
  await updateChatSettings(h.t.db, id, { provider: 'claude', level });
  return id;
}

export async function send(h: CompactionHarness, conversationId: string, content: string) {
  const sent = await sendUserMessage(
    h.t.db,
    conversationId,
    { id: randomUUID(), content },
    TARGET,
  );
  h.worker.wake();
  return sent.run.id;
}

export async function finished(h: CompactionHarness, runId: string) {
  return eventually(async () => {
    const run = await getRun(h.t.db, runId);
    return run?.finishedAt ? run : null;
  }, 20_000);
}

export async function say(h: CompactionHarness, conversationId: string, content: string) {
  const runId = await send(h, conversationId, content);
  const run = await finished(h, runId);
  return { run, steps: await stepsOf(h, runId) };
}

export async function stepsOf(h: CompactionHarness, runId: string): Promise<string[]> {
  const { rows } = await h.t.db.query<{ name: string }>(
    `SELECT payload->>'stepName' AS name FROM run_events
     WHERE run_id = $1 AND type = 'STEP_STARTED' ORDER BY seq`,
    [runId],
  );
  return rows.map((row) => row.name);
}

export async function sessionsOf(h: CompactionHarness, conversationId: string) {
  const { rows } = await h.t.db.query<{
    id: string;
    session_id: string;
    close_reason: string | null;
    context_used: number | null;
    compact_snoozed: boolean;
  }>(
    `SELECT id, session_id, close_reason, context_used, compact_snoozed FROM provider_sessions
     WHERE conversation_id = $1 ORDER BY created_at`,
    [conversationId],
  );
  return rows;
}

export function promptsOf(h: CompactionHarness, sessionId: string): string[] {
  const stored = JSON.parse(readFileSync(join(h.store, `${sessionId}.json`), 'utf8')) as {
    prompts: string[];
  };
  return stored.prompts;
}

export async function compactionsOf(h: CompactionHarness, conversationId: string) {
  const { rows } = await h.t.db.query<{
    method: string;
    run_id: string | null;
    tokens_before: number | null;
    tokens_after: number | null;
    summary: string | null;
    from_conversation_id: string | null;
  }>(
    `SELECT method, run_id, tokens_before, tokens_after, summary, from_conversation_id
     FROM compactions WHERE conversation_id = $1 ORDER BY created_at`,
    [conversationId],
  );
  return rows;
}

export async function pendingCard(h: CompactionHarness, runId: string) {
  return eventually(async () => {
    const { rows } = await h.t.db.query<{ id: string; kind: string; options: unknown }>(
      `SELECT id, kind, options FROM approvals WHERE run_id = $1 AND status = 'pending'`,
      [runId],
    );
    return rows[0] ?? null;
  }, 20_000);
}

export const percentOf = (percent: number) => Math.round((CONTEXT_SIZE * percent) / 100);

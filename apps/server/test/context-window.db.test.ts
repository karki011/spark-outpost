import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { updateChatSettings } from '../src/persistence/chat-settings.ts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { stopRun } from '../src/workflow/stop-run.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { FAKE_ACP_LAUNCH } from './fake-acp-support.ts';
import { WINDOW_HOLD_TRIGGER } from './fake-acp-window.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { AGENT_MODELS, connectAgents } from './turn-worker.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const TARGET = { provider: 'claude', model: 'opus[1m]', effort: 'medium' } as const;

let t: TestDb;
let worker: Worker;
let store: string;

beforeEach(async () => {
  t = await createTestDb();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-window-'));
  await connectAgents(t);
  const provider = createAcpProvider({
    definition: { ...agentDefinitions.claude, ...FAKE_AGENT_MODES },
    launch: FAKE_ACP_LAUNCH,
    cancelGraceMs: 2_000,
    env: {
      ...(process.env as Record<string, string>),
      FAKE_ACP_MODELS: JSON.stringify(AGENT_MODELS.claude.map((model) => [model.id, model.label])),
      FAKE_ACP_SESSION_STORE: store,
      FAKE_ACP_SESSION_CAPABILITIES: JSON.stringify({ resume: {}, close: {} }),
    },
  });
  worker = startWorker({
    db: t.db,
    providers: new Map([['claude', provider]]),
    leaseSeconds: 30,
    concurrency: 1,
    pollMs: 20,
    cancelPollMs: 20,
  });
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
  rmSync(store, { recursive: true, force: true });
});

async function newChat(): Promise<string> {
  const { id } = await createConversation(t.db, t.workspaceId, randomUUID());
  await updateChatSettings(t.db, id, { provider: 'claude', level: 'hands-off' });
  return id;
}

async function send(conversationId: string, content: string): Promise<string> {
  const sent = await sendUserMessage(t.db, conversationId, { id: randomUUID(), content }, TARGET);
  worker.wake();
  return sent.run.id;
}

async function finished(runId: string) {
  return eventually(async () => {
    const run = await getRun(t.db, runId);
    return run?.finishedAt ? run : null;
  }, 20_000);
}

async function contextOf(runId: string) {
  const run = await getRun(t.db, runId);
  return run?.usage ? { used: run.usage.contextUsed, size: run.usage.contextSize } : null;
}

async function sessionContext(conversationId: string) {
  const { rows } = await t.db.query<{ context_used: number | null; context_size: number | null }>(
    `SELECT context_used, context_size FROM provider_sessions
     WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [conversationId],
  );
  return rows[0] ?? null;
}

async function midTurn(runId: string) {
  return eventually(async () => {
    const context = await contextOf(runId);
    return context?.used ? context : null;
  }, 20_000);
}

describe('the context window a Claude turn records', { timeout: 60_000 }, () => {
  it("records the model's window, not the adapter's 200K placeholder, through the turn", async () => {
    const chat = await newChat();
    const runId = await send(chat, '#window:long');
    expect((await finished(runId)).status).toBe('succeeded');
    expect(await contextOf(runId)).toEqual({ used: 134_000, size: 1_000_000 });
  });

  it('keeps the 1M window mid-turn and after the turn is stopped before its result', async () => {
    const chat = await newChat();
    const runId = await send(chat, `#window:midturn ${WINDOW_HOLD_TRIGGER}`);
    expect(await midTurn(runId)).toEqual({ used: 140_000, size: 1_000_000 });
    await stopRun(t.db, runId);
    expect((await finished(runId)).status).toBe('cancelled');
    expect(await contextOf(runId)).toEqual({ used: 140_000, size: 1_000_000 });
    expect(await sessionContext(chat)).toEqual({ context_used: 140_000, context_size: 1_000_000 });
  });

  it('keeps a smaller window the account reported for that model on the next turn', async () => {
    const chat = await newChat();
    await finished(await send(chat, '#window:short'));
    expect(await sessionContext(chat)).toEqual({ context_used: 150_000, context_size: 200_000 });

    const runId = await send(chat, `#window:midturn ${WINDOW_HOLD_TRIGGER}`);
    expect(await midTurn(runId)).toEqual({ used: 140_000, size: 200_000 });
    await stopRun(t.db, runId);
    await finished(runId);
  });
});

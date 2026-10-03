import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { closeConversationSessions } from '../src/persistence/provider-sessions.ts';
import { getRun, requestCancel } from '../src/persistence/runs.ts';
import type { Provider } from '../src/providers/provider.ts';
import { STOPPED_NOTE } from '../src/workflow/session-decision.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { CLAUDE_MODELS, connectProviders } from './orchestration-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import { FAKE_ACP_LAUNCH } from './fake-acp-support.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';

const CLAUDE_TARGET = {
  provider: 'claude',
  model: 'sonnet',
  effort: 'medium',
  permission: 'ask',
  level: 'hands-off',
} as const;

let t: TestDb;
let worker: Worker;
let store: string;

function fakeClaude(): Provider {
  return createAcpProvider({
    definition: { ...agentDefinitions.claude, ...FAKE_AGENT_MODES },
    launch: FAKE_ACP_LAUNCH,
    cancelGraceMs: 2_000,
    env: {
      ...(process.env as Record<string, string>),
      FAKE_ACP_MODELS: JSON.stringify(CLAUDE_MODELS.map((model) => [model.id, model.label])),
      FAKE_ACP_SESSION_STORE: store,
      FAKE_ACP_SESSION_CAPABILITIES: JSON.stringify({ resume: {}, close: {} }),
    },
  });
}

beforeEach(async () => {
  t = await createTestDb();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
  await connectProviders(t, false);
  worker = startWorker({
    db: t.db,
    providers: new Map([['claude', fakeClaude()]]),
    leaseSeconds: 30,
    concurrency: 2,
    pollMs: 20,
    cancelPollMs: 20,
  });
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
  rmSync(store, { recursive: true, force: true });
});

async function say(conversationId: string, content: string) {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    CLAUDE_TARGET,
  );
  worker.wake();
  const run = await eventually(async () => {
    const current = await getRun(t.db, sent.run.id);
    return current?.finishedAt ? current : null;
  }, 20_000);
  expect(run.status).toBe('succeeded');
  const { rows } = await t.db.query<{ name: string }>(
    `SELECT payload->>'stepName' AS name FROM run_events
     WHERE run_id = $1 AND type = 'STEP_STARTED' ORDER BY seq`,
    [sent.run.id],
  );
  return rows.map((row) => row.name);
}

async function sessionIds(conversationId: string) {
  const { rows } = await t.db.query<{ session_id: string; close_reason: string | null }>(
    'SELECT session_id, close_reason FROM provider_sessions WHERE conversation_id = $1 ORDER BY created_at',
    [conversationId],
  );
  return rows;
}

describe('chat turns reuse the agent session', { timeout: 60_000 }, () => {
  it('continues the session on turn 2 and starts fresh after Start fresh', async () => {
    const { id } = await createConversation(t.db, t.workspaceId, randomUUID());
    expect(await say(id, 'Remember PELICAN')).not.toContain('Continued session');
    const second = await say(id, 'Which word? #recall');
    expect(second).toContain('Continued session');
    expect(second.some((step) => step.startsWith('Recalled'))).toBe(false);
    const [first] = await sessionIds(id);
    const stored = JSON.parse(readFileSync(join(store, `${first!.session_id}.json`), 'utf8')) as {
      prompts: string[];
    };
    expect(stored.prompts).toHaveLength(2);
    expect(stored.prompts[1]).toMatch(/^Which word\? #recall/);
    expect(stored.prompts[1]).not.toContain('Earlier messages');

    await closeConversationSessions(t.db, t.workspaceId, id, 'started fresh');
    const third = await say(id, 'And now?');
    expect(third).toContain('Fresh session (started fresh)');
    expect(third.some((step) => step.startsWith('Recalled'))).toBe(true);
    const sessions = await sessionIds(id);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ close_reason: 'started fresh' });
    expect(sessions[1]).toMatchObject({ close_reason: null });
    expect(sessions[1]!.session_id).not.toBe(first!.session_id);
  });
});

describe('a chat turn the user stopped', { timeout: 60_000 }, () => {
  it('resumes the same session with a stop note on the next message', async () => {
    const { id } = await createConversation(t.db, t.workspaceId, randomUUID());
    const sent = await sendUserMessage(
      t.db,
      id,
      { id: randomUUID(), content: 'Tell me a long story #slow' },
      CLAUDE_TARGET,
    );
    worker.wake();
    await eventually(async () => {
      const { rows } = await t.db.query(
        `SELECT 1 FROM run_events WHERE run_id = $1 AND type = 'TEXT_MESSAGE_CONTENT'`,
        [sent.run.id],
      );
      return rows.length > 2 ? true : null;
    }, 20_000);
    await requestCancel(t.db, sent.run.id);
    const stopped = await eventually(async () => {
      const current = await getRun(t.db, sent.run.id);
      return current?.finishedAt ? current : null;
    }, 20_000);
    expect(stopped.status).toBe('cancelled');

    const next = await say(id, 'go on');
    expect(next).toContain('Continued session');
    const sessions = await sessionIds(id);
    expect(sessions).toHaveLength(1);
    const stored = JSON.parse(
      readFileSync(join(store, `${sessions[0]!.session_id}.json`), 'utf8'),
    ) as { prompts: string[] };
    expect(stored.prompts).toHaveLength(2);
    expect(stored.prompts[1]).toContain(STOPPED_NOTE);
    expect(stored.prompts[1]).toContain('go on');
  });
});

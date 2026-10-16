import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureAssistantChat } from '../src/companion/assistant.ts';
import {
  assistantIdleCompaction,
  type AssistantIdleCompaction,
} from '../src/companion/assistant-idle.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, localClient } from './app-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import { connectAgents, fakeAgents } from './turn-worker.ts';

let t: TestDb;
let store: string;
let worker: Worker;
let idle: AssistantIdleCompaction;
let assistant: string;

const LATER = () => new Date(Date.now() + 16 * 60_000);

beforeEach(async () => {
  t = await createTestDb();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-assistant-idle-'));
  await connectAgents(t);
  await t.db.query(
    `INSERT INTO profiles (workspace_id, display_name, default_provider, onboarding_completed_at)
     VALUES ($1, 'Test User', 'claude', now())`,
    [t.workspaceId],
  );
  assistant = await ensureAssistantChat(t.db, t.workspaceId);
  const providers = fakeAgents({
    sessions: store,
    agentEnv: { FAKE_ACP_COMMANDS: '["compact"]', FAKE_ACP_CONTEXT_SIZE: '200000' },
  });
  idle = assistantIdleCompaction(t.db, providers);
  worker = startWorker({
    db: t.db,
    providers,
    leaseSeconds: 30,
    concurrency: 4,
    pollMs: 20,
    cancelPollMs: 20,
    recoveryEveryMs: 60 * 60_000,
    assistantIdle: idle,
  });
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
  rmSync(store, { recursive: true, force: true });
});

async function queue(question: string): Promise<string> {
  const id = randomUUID();
  const app = localClient(createTestApp(t, { fixedRunProvider: null }));
  await app.send('post', `/api/conversations/${assistant}/queue`, { id, content: question });
  return id;
}

async function answered(messageId: string): Promise<void> {
  await eventually(async () => {
    const detail = await getConversationDetail(t.db, assistant);
    const run = detail?.runs.find((entry) => entry.userMessageId === messageId);
    return run?.status === 'succeeded';
  }, 90_000);
}

function prompts(): string[] {
  const files = readdirSync(store).filter((file) => !file.endsWith('.config.json'));
  expect(files).toHaveLength(1);
  return (JSON.parse(readFileSync(join(store, files[0]!), 'utf8')) as { prompts: string[] })
    .prompts;
}

async function kinds(): Promise<string[]> {
  const { rows } = await t.db.query<{ kind: string }>(
    'SELECT kind FROM assistant_events WHERE workspace_id = $1 ORDER BY at, id',
    [t.workspaceId],
  );
  return rows.map((row) => row.kind);
}

describe('Ask Spark idle compaction', { timeout: 240_000 }, () => {
  it('compacts the same session after 15 idle minutes and keeps it for the next question', async () => {
    await answered(await queue('the word is pineapple #ctx40'));
    await idle.sweep(new Date());
    await idle.wait(assistant);
    expect(await kinds()).not.toContain('compacted_idle');

    await idle.sweep(LATER());
    await idle.wait(assistant);
    expect(await kinds()).toContain('compacted_idle');
    expect(prompts().at(-1)).toBe('/compact');

    await answered(await queue('what was the word?'));
    expect(prompts()).toHaveLength(3);
    expect(prompts().at(-1)).toContain('what was the word?');
    const { rows } = await t.db.query<{ method: string }>(
      `SELECT method FROM compactions WHERE conversation_id = $1`,
      [assistant],
    );
    expect(rows).toEqual([{ method: 'agent' }]);

    await idle.sweep(LATER());
    await idle.wait(assistant);
    expect((await kinds()).filter((kind) => kind === 'compacted_idle')).toHaveLength(1);
  });

  it('makes a question that arrives during compaction wait for it', async () => {
    await answered(await queue('first question #ctx40'));
    const sweeping = idle.sweep(LATER());
    const question = await queue('second question');
    await sweeping;
    await answered(question);
    const [compact, next] = prompts().slice(-2);
    expect(compact).toBe('/compact');
    expect(next).toContain('second question');
  });

  it('compacts without a card when the context passes the compaction threshold', async () => {
    await answered(await queue('a long answer please #ctx85'));
    await answered(await queue('and another question'));
    expect(await kinds()).toContain('compacted_threshold');
    const [compact, next] = prompts().slice(-2);
    expect(compact).toBe('/compact');
    expect(next).toContain('and another question');
    const cards = await t.db.query(
      `SELECT 1 FROM approvals a JOIN runs r ON r.id = a.run_id WHERE r.conversation_id = $1`,
      [assistant],
    );
    expect(cards.rowCount).toBe(0);
  });

  it('still compacts at the threshold when automatic compaction is off for chats', async () => {
    await t.db.query('UPDATE profiles SET auto_compact = false WHERE workspace_id = $1', [
      t.workspaceId,
    ]);
    await answered(await queue('a long answer please #ctx85'));
    await answered(await queue('and another question'));
    expect(await kinds()).toContain('compacted_threshold');
    expect(prompts().slice(-2)[0]).toBe('/compact');
  });
});

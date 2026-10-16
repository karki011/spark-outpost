import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usageSummarySchema, type Run } from '@spark-outpost/contracts';
import { ensureAssistantChat } from '../src/companion/assistant.ts';
import { ASSISTANT_AUDIT_METHOD } from '../src/companion/assistant-events.ts';
import { LIVE_STATE_NOTE } from '../src/companion/assistant-turn.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { createTestApp, localClient } from './app-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import { auditOf } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

let t: TestDb;
let store: string;
let worker: Worker;
let assistant: string;

beforeEach(async () => {
  t = await createTestDb();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-assistant-'));
  await connectAgents(t);
  await t.db.query(
    `UPDATE provider_capabilities SET models = $2 WHERE workspace_id = $1 AND provider = 'claude'`,
    [
      t.workspaceId,
      JSON.stringify([
        { id: 'sonnet', label: 'Sonnet 5.5', description: null },
        { id: 'opus[1m]', label: 'Opus 5.5', description: null },
      ]),
    ],
  );
  await t.db.query(
    `INSERT INTO profiles (workspace_id, display_name, default_provider, onboarding_completed_at)
     VALUES ($1, 'Test User', 'claude', now())`,
    [t.workspaceId],
  );
  assistant = await ensureAssistantChat(t.db, t.workspaceId);
  worker = startTurnWorker(t, { sessions: store });
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
  rmSync(store, { recursive: true, force: true });
});

function api() {
  return localClient(createTestApp(t, { fixedRunProvider: null }));
}

async function finished(messageId: string): Promise<Run> {
  return eventually(async () => {
    const detail = await getConversationDetail(t.db, assistant);
    const message = detail?.messages.find((entry) => entry.id === messageId);
    const run = detail?.runs.find((entry) => entry.userMessageId === message?.id);
    return run && ['succeeded', 'failed'].includes(run.status) ? run : undefined;
  }, 90_000);
}

async function ask(question: string): Promise<{ run: Run; reply: string }> {
  const id = randomUUID();
  const queued = await api().send('post', `/api/conversations/${assistant}/queue`, {
    id,
    content: question,
  });
  expect(queued.status).toBe(201);
  const run = await finished(id);
  expect(run.status).toBe('succeeded');
  const detail = await getConversationDetail(t.db, assistant);
  const reply = detail!.messages.find((entry) => entry.runId === run.id)?.content ?? '';
  return { run, reply };
}

async function eventKinds(): Promise<string[]> {
  const { rows } = await t.db.query<{ kind: string }>(
    'SELECT kind FROM assistant_events WHERE workspace_id = $1 ORDER BY at, id',
    [t.workspaceId],
  );
  return rows.map((row) => row.kind);
}

async function auditedKinds(runId: string): Promise<string[]> {
  return (await auditOf(t, runId))
    .filter((entry) => entry.direction === 'harness')
    .map((entry) => (entry.payload as { method?: string }).method ?? '')
    .filter((method) => method.startsWith(`${ASSISTANT_AUDIT_METHOD}/`))
    .map((method) => method.slice(ASSISTANT_AUDIT_METHOD.length + 1));
}

async function restart(): Promise<void> {
  await worker.stop();
  worker = startTurnWorker(t, { sessions: store });
}

describe('the persistent Ask Spark session', { timeout: 240_000 }, () => {
  it('answers on the fast model and keeps one session across a restart', async () => {
    const first = await ask('remember the word pineapple');
    expect(first.reply).toContain('model=sonnet effort=low');
    expect(first.run).toMatchObject({ model: 'sonnet', effort: 'low' });

    await restart();
    const second = await ask('what word did I ask you to remember?');

    expect(readdirSync(store).filter((file) => !file.endsWith('.config.json'))).toHaveLength(1);
    expect(second.reply).toContain('the word pineapple');
    expect(await eventKinds()).toEqual(['fact_added', 'session_started', 'session_resumed']);
    expect(await auditedKinds(first.run.id)).toEqual(['fact_added', 'session_started']);
    expect(await auditedKinds(second.run.id)).toEqual(['session_resumed']);
  });

  it('sends the live-state rule with every question, even after an earlier answer', async () => {
    await ask('Who needs me?');
    const again = await ask('Who needs me?');
    expect(again.reply).toContain(LIVE_STATE_NOTE);
  });

  it('starts a new session from a summary when the old one is gone, and keeps the facts', async () => {
    await ask('remember the word pineapple');
    for (const file of readdirSync(store)) rmSync(join(store, file));
    const next = await ask('what word did I ask you to remember?');

    expect(next.reply).toContain('the word pineapple');
    expect(await eventKinds()).toContain('session_reseeded');
    expect(await auditedKinds(next.run.id)).toEqual(['session_reseeded']);
  });

  it('moves to another provider with a handoff and a notice, keeping the facts', async () => {
    await ask('remember the word pineapple');
    const saved = await api().send('put', '/api/spark-assistant/settings', {
      provider: 'codex',
      modelChoice: 'fast',
      model: null,
      effort: null,
    });
    expect(saved.body.notice).toBe(
      'Ask Spark moved from Claude to Codex. Its new session starts from a summary of the old one.',
    );
    const next = await ask('what word did I ask you to remember?');

    expect(next.run).toMatchObject({ provider: 'codex', model: 'gpt-6-luna', effort: 'low' });
    expect(next.reply).toContain('the word pineapple');
    expect(await auditedKinds(next.run.id)).toEqual(['settings_changed', 'session_reseeded']);
  });

  it('runs questions that arrive together one after another, in order', async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (const [index, id] of ids.entries()) {
      await api().send('post', `/api/conversations/${assistant}/queue`, {
        id,
        content: `question ${index + 1}`,
      });
    }
    const runs = [];
    for (const id of ids) runs.push(await finished(id));
    const { rows } = await t.db.query<{ id: string; started_at: Date; finished_at: Date }>(
      `SELECT id, started_at, finished_at FROM runs WHERE conversation_id = $1
       ORDER BY started_at`,
      [assistant],
    );
    expect(rows.map((row) => row.id)).toEqual(runs.map((run) => run.id));
    for (let index = 1; index < rows.length; index += 1) {
      expect(rows[index]!.started_at.getTime()).toBeGreaterThanOrEqual(
        rows[index - 1]!.finished_at.getTime(),
      );
    }
  });

  it('forgets the history after Clear history but keeps the key facts', async () => {
    await ask('remember the word pineapple');
    await ask('my favourite colour is teal');
    await api().send('post', '/api/spark-assistant/clear', { facts: false });
    const next = await ask('what do you know?');

    expect(next.reply).toContain('the word pineapple');
    expect(next.reply).not.toContain('teal');
    expect(await auditedKinds(next.run.id)).toEqual(['history_cleared', 'session_started']);
  });

  it('keeps cleared history out of the handoff to another provider', async () => {
    await ask('remember the word pineapple');
    await ask('my favourite colour is teal');
    await api().send('post', '/api/spark-assistant/clear', { facts: false });
    await api().send('put', '/api/spark-assistant/settings', {
      provider: 'codex',
      modelChoice: 'fast',
      model: null,
      effort: null,
    });
    const next = await ask('what do you know?');

    expect(next.run.provider).toBe('codex');
    expect(next.reply).toContain('the word pineapple');
    expect(next.reply).not.toContain('teal');
  });

  it('shows only Ask Spark runs in the assistant usage', async () => {
    await ask('Who needs me?');
    const usage = usageSummarySchema.parse(
      (await api().get('/api/usage/summary?scope=assistant')).body,
    );
    expect(usage.allTime.map((row) => [row.provider, row.runs])).toEqual([['claude', 1]]);
  });
});

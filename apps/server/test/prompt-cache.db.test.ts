import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConversationDetail } from '@spark-outpost/contracts';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { promptCacheFor, recordRequestUsage } from '../src/persistence/prompt-cache.ts';
import { getRun } from '../src/persistence/runs.ts';
import type { RequestUsage } from '../src/providers/provider.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { FAKE_ACP_LAUNCH as launch } from './fake-acp-support.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { connectCliProvider, createTestDb, eventually, type TestDb } from './support.ts';

const recorded = fileURLToPath(new URL('./fixtures/prompt-cache/sdk-messages.json', import.meta.url));
const AT = new Date('2026-10-17T12:00:00Z');
const later = (seconds: number) => new Date(AT.getTime() + seconds * 1000);

let t: TestDb;
let worker: Worker | null = null;

beforeEach(async () => {
  t = await createTestDb();
  await connectCliProvider(t, 'claude');
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
});

const usage = (key: string, extra: Partial<RequestUsage> = {}): RequestUsage => ({
  key,
  model: 'claude-opus-5-5',
  input: 2,
  output: 100,
  cachedRead: 150_000,
  cachedWrite: 1_000,
  buckets: { short: 0, long: 1_000 },
  ...extra,
});

async function newChat() {
  const conversationId = randomUUID();
  await createConversation(t.db, t.workspaceId, conversationId);
  return conversationId;
}

async function turn(conversationId: string) {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: 'hi' },
    { provider: 'claude', model: null, effort: null },
    t.workspaceId,
  );
  await t.db.query(`UPDATE runs SET status = 'succeeded', finished_at = now() WHERE id = $1`, [
    sent.run.id,
  ]);
  return sent.run.id;
}

async function detail(conversationId: string): Promise<ConversationDetail> {
  const response = await request(createTestApp(t))
    .get(`/api/conversations/${conversationId}`)
    .set(LOCAL_HEADERS)
    .set('Origin', ORIGIN)
    .expect(200);
  return response.body as ConversationDetail;
}

describe('a chat’s prompt cache', () => {
  it('keeps the first request’s write and the latest request’s context, once per request', async () => {
    const chat = await newChat();
    const runId = await turn(chat);
    await recordRequestUsage(t.db, runId, usage('msg_1', { output: 1 }), AT);
    await recordRequestUsage(t.db, runId, usage('msg_1', { output: 40 }), later(1));
    await recordRequestUsage(t.db, runId, usage('msg_2', { cachedWrite: 9 }), later(30));
    await recordRequestUsage(t.db, runId, usage('msg_1', { cachedWrite: 7 }), later(2));
    const { rows } = await t.db.query(
      'SELECT first_write, last_key, last_context, last_at, ttl_seconds FROM run_prompt_cache',
    );
    expect(rows).toEqual([
      {
        first_write: 7,
        last_key: 'msg_2',
        last_context: 2 + 100 + 150_000 + 9,
        last_at: later(30),
        ttl_seconds: 3600,
      },
    ]);
  });

  it('notes a turn that re-wrote the previous context and serves the countdown with the chat', async () => {
    const chat = await newChat();
    const first = await turn(chat);
    await recordRequestUsage(t.db, first, usage('a1', { cachedWrite: 20_000 }), AT);
    await recordRequestUsage(t.db, first, usage('a2', { cachedRead: 181_000 }), later(10));
    const second = await turn(chat);
    await recordRequestUsage(
      t.db,
      second,
      usage('b1', { cachedRead: 0, cachedWrite: 181_500 }),
      later(4000),
    );
    const cache = await promptCacheFor(t.db, chat);
    expect(Object.keys(cache.rebuilds)).toEqual([second]);
    expect(cache.rebuilds[second]!.tokens).toBe(181_500);
    const shown = await detail(chat);
    expect(shown.promptCache?.last).toMatchObject({
      at: later(4000).toISOString(),
      contextTokens: 2 + 100 + 181_500,
      ttlSeconds: 3600,
      expired: null,
    });
  });

  it('serves nothing for a chat without request figures', async () => {
    const chat = await newChat();
    await turn(chat);
    expect((await detail(chat)).promptCache).toBeUndefined();
  });

  it('drops figures for a run that is gone', async () => {
    await recordRequestUsage(t.db, randomUUID(), usage('msg_1'), AT);
    expect((await t.db.query('SELECT 1 FROM run_prompt_cache')).rowCount).toBe(0);
  });
});

describe('a Claude chat turn that reports its requests', { timeout: 60_000 }, () => {
  it('stores the recorded request’s cache figures through the adapter route', async () => {
    const provider = createAcpProvider({
      definition: { ...agentDefinitions.claude, ...FAKE_AGENT_MODES },
      launch,
      cancelGraceMs: 2_000,
      env: { ...childEnvironment(process.env), FAKE_ACP_SDK_MESSAGES: recorded },
    });
    worker = startWorker({
      db: t.db,
      providers: new Map([['claude', provider]]),
      leaseSeconds: 30,
      concurrency: 2,
      pollMs: 20,
      cancelPollMs: 20,
    });
    const chat = await newChat();
    const sent = await sendUserMessage(
      t.db,
      chat,
      { id: randomUUID(), content: '#requests' },
      { provider: 'claude', model: null, effort: null },
      t.workspaceId,
    );
    const run = await eventually(async () => {
      const current = await getRun(t.db, sent.run.id);
      return current?.finishedAt ? current : null;
    });
    expect(run.status).toBe('succeeded');
    const { rows } = await t.db.query(
      'SELECT first_key, first_write, last_context, model, ttl_seconds FROM run_prompt_cache',
    );
    expect(rows).toEqual([
      {
        first_key: 'msg_011Cg8UBjn2R9Vmwgp4RXJ3G',
        first_write: 12_185,
        last_context: 2 + 4 + 26_499 + 12_185,
        model: 'claude-haiku-5-5',
        ttl_seconds: 3600,
      },
    ]);
  });
});

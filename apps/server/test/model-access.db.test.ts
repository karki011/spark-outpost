import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MODEL_SWITCH_ACTIVITY, type ProviderCapabilities } from '@spark-outpost/contracts';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { loadAccess, markModelRejected, recordAccount } from '../src/model-access/store.ts';
import { loadIntakeContext } from '../src/persistence/advice.ts';
import { saveCapabilities } from '../src/persistence/chat-settings.ts';
import {
  createConversation,
  getConversationDetail,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { rejectionBody } from './fake-acp-access.ts';
import { FAKE_ACP_LAUNCH as launch } from './fake-acp-support.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { connectCliProvider, createTestDb, eventually, type TestDb } from './support.ts';

const MODELS = [
  { id: 'gpt-6-luna', label: '6 Luna', description: 'Fast' },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', description: 'Newest' },
  { id: 'gpt-6-sol', label: '6 Sol', description: 'Workhorse' },
];
const EFFORTS = [{ id: 'medium', label: 'Medium', description: null }];
const CHATGPT = { kind: 'account' as const, label: 'ChatGPT Plus', plan: 'plus' };
const AUTH_STATUS = {
  authStatus: { kind: 'account', label: 'ChatGPT Plus', account: { plan: 'plus' } },
};
const SOL_61 = 'gpt-6.1-sol';

let t: TestDb;
let worker: Worker | null = null;

beforeEach(async () => {
  t = await createTestDb();
  await connectCliProvider(t, 'codex');
  await saveCapabilities(t.db, t.workspaceId, {
    provider: 'codex',
    models: MODELS,
    efforts: EFFORTS,
    defaultModel: 'gpt-6-sol',
    access: { reported: true, unlisted: [], account: CHATGPT },
  });
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
});

function startCodex(rejects: string[] = [SOL_61]) {
  const provider = createAcpProvider({
    definition: { ...agentDefinitions.codex, ...FAKE_AGENT_MODES },
    launch,
    cancelGraceMs: 2_000,
    env: {
      ...childEnvironment(process.env),
      FAKE_ACP_MODELS: JSON.stringify(MODELS.map((model) => [model.id, model.label])),
      FAKE_ACP_REJECT_MODELS: JSON.stringify(rejects),
      FAKE_ACP_AUTH_STATUS: JSON.stringify(AUTH_STATUS),
    },
  });
  worker = startWorker({
    db: t.db,
    providers: new Map([['codex', provider]]),
    leaseSeconds: 30,
    concurrency: 2,
    pollMs: 20,
    cancelPollMs: 20,
  });
}

async function send(content: string, model: string | null = SOL_61, conversationId = randomUUID()) {
  await createConversation(t.db, t.workspaceId, conversationId);
  await t.db.query(`UPDATE conversations SET model_routing = 'pinned' WHERE id = $1`, [
    conversationId,
  ]);
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    { provider: 'codex', model, effort: 'medium' },
    t.workspaceId,
  );
  const run = await eventually(async () => {
    const current = await getRun(t.db, sent.run.id);
    return current?.finishedAt ? current : null;
  });
  return { run, conversationId };
}

async function usedModel(runId: string): Promise<string | null> {
  const { rows } = await t.db.query<{ used_model: string | null }>(
    'SELECT used_model FROM runs WHERE id = $1',
    [runId],
  );
  return rows[0]?.used_model ?? null;
}

async function prompts(runId: string): Promise<number> {
  const { rows } = await t.db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM run_protocol_log
     WHERE run_id = $1 AND method = 'session/prompt' AND kind = 'request'`,
    [runId],
  );
  return rows[0]!.count;
}

async function capabilities(): Promise<ProviderCapabilities> {
  const response = await request(createTestApp(t, { fixedRunProvider: null }))
    .get('/api/providers/codex/capabilities')
    .set(LOCAL_HEADERS)
    .set('Origin', ORIGIN)
    .expect(200);
  return response.body as ProviderCapabilities;
}

const availability = (caps: ProviderCapabilities) =>
  Object.fromEntries(caps.models.map((model) => [model.id, model.availability]));

describe('a model the sign-in cannot use', { timeout: 60_000 }, () => {
  it('is learned from the rejection and the turn runs once more on the nearest usable model', async () => {
    startCodex();
    const { run, conversationId } = await send('Hello there');

    expect(run.status).toBe('succeeded');
    expect(run.error).toBeNull();
    expect(await usedModel(run.id)).toBe('gpt-6-sol');
    expect(await prompts(run.id)).toBe(2);
    expect(run.modelSwitch).toEqual({
      provider: 'codex',
      signIn: 'ChatGPT sign-in',
      from: { id: SOL_61, label: 'GPT-6.1 Sol' },
      to: { id: 'gpt-6-sol', label: '6 Sol' },
      learned: true,
    });
    const access = await loadAccess(t.db, t.workspaceId, 'codex');
    expect(access?.rejected.map((entry) => entry.id)).toEqual([SOL_61]);
    expect(access?.account).toEqual(CHATGPT);

    const detail = await getConversationDetail(t.db, conversationId);
    const reply = detail?.messages.find((message) => message.role === 'assistant');
    expect(reply?.content).toContain('model=gpt-6-sol');
    expect(detail?.runs[0]?.modelSwitch?.to?.id).toBe('gpt-6-sol');
    const { rows } = await t.db.query<{ payload: { activityType?: string } }>(
      `SELECT payload FROM run_events WHERE run_id = $1 AND type = 'ACTIVITY_SNAPSHOT'`,
      [run.id],
    );
    expect(rows.map((row) => row.payload.activityType)).toContain(MODEL_SWITCH_ACTIVITY);
    expect(detail?.activity[run.id]?.map((step) => step.name)).toContain(
      "GPT-6.1 Sol isn't usable with your ChatGPT sign-in; using 6 Sol",
    );
  });

  it('retries only once: a second rejection stops with plain words and keeps the raw body aside', async () => {
    startCodex([SOL_61, 'gpt-6-sol']);
    const { run } = await send('Hello there');

    expect(run.status).toBe('failed');
    expect(await prompts(run.id)).toBe(2);
    expect(run.error).toBe(
      "Your ChatGPT sign-in can't use 6 Sol. Pick another model in Settings > Models, then send the message again.",
    );
    expect(run.error).not.toContain('{');
    expect(run.errorDetails).toBe(rejectionBody('gpt-6-sol'));
    const access = await loadAccess(t.db, t.workspaceId, 'codex');
    expect(access?.rejected.map((entry) => entry.id)).toEqual([SOL_61, 'gpt-6-sol']);
  });

  it('does not retry once a tool call has happened in the turn', async () => {
    startCodex();
    const { run } = await send('Look first #toolfirst');

    expect(run.status).toBe('failed');
    expect(await prompts(run.id)).toBe(1);
    expect(run.error).toBe(
      "Your ChatGPT sign-in can't use GPT-6.1 Sol. This turn had already started work, so Spark did not run it again on another model. Pick another model in Settings > Models, then send the message again.",
    );
    expect(run.errorDetails).toBe(rejectionBody(SOL_61));
    expect(run.modelSwitch).toMatchObject({ from: { id: SOL_61 }, to: null });
    const access = await loadAccess(t.db, t.workspaceId, 'codex');
    expect(access?.rejected.map((entry) => entry.id)).toEqual([SOL_61]);
  });

  it('is avoided before the next turn starts, also after a restart', async () => {
    startCodex();
    const first = await send('Hello there');
    await worker?.stop();
    startCodex();

    const second = await send('And again', SOL_61, first.conversationId);
    expect(second.run.status).toBe('succeeded');
    expect(await prompts(second.run.id)).toBe(1);
    expect(await usedModel(second.run.id)).toBe('gpt-6-sol');
    expect(second.run.modelSwitch).toMatchObject({ learned: false, to: { id: 'gpt-6-sol' } });
    const access = await loadAccess(t.db, t.workspaceId, 'codex');
    expect(access?.rejected.map((entry) => entry.id)).toEqual([SOL_61]);
    expect(access?.listed).toEqual(MODELS.map((model) => model.id));
  });

  it('learns the model from the session when the chat ran on the agent default', async () => {
    startCodex(['gpt-6-luna']);
    const { run } = await send('Hello there', null);
    expect(run.status).toBe('succeeded');
    expect(run.modelSwitch).toMatchObject({ from: { id: 'gpt-6-luna' }, learned: true });
    expect(await usedModel(run.id)).not.toBe('gpt-6-luna');
  });
});

describe('what the picker, the default and routing see', { timeout: 60_000 }, () => {
  it('rates each model for the connection and reports the account and counts', async () => {
    const before = await capabilities();
    expect(availability(before)).toEqual({
      'gpt-6-luna': 'usable',
      [SOL_61]: 'usable',
      'gpt-6-sol': 'usable',
    });
    expect(before.access).toMatchObject({
      account: CHATGPT,
      signIn: 'ChatGPT sign-in',
      reported: true,
      usable: 3,
      unusable: [],
      defaultIssue: null,
    });

    startCodex();
    await send('Hello there');
    const after = await capabilities();
    expect(availability(after)[SOL_61]).toBe('unusable');
    expect(after.access).toMatchObject({
      usable: 2,
      unusable: [{ id: SOL_61, label: 'GPT-6.1 Sol' }],
    });
    expect(after.access?.checkedAt).not.toBeNull();
  });

  it('flags a default the sign-in cannot use and suggests the nearest usable model', async () => {
    await t.db.query(`UPDATE provider_connections SET model = $1 WHERE provider = 'codex'`, [
      SOL_61,
    ]);
    expect((await capabilities()).access?.defaultIssue).toBeNull();
    startCodex();
    await send('Hello there', null);
    await send('Hello again');
    expect((await capabilities()).access?.defaultIssue).toEqual({
      model: { id: SOL_61, label: 'GPT-6.1 Sol' },
      suggestion: { id: 'gpt-6-sol', label: '6 Sol' },
    });
  });

  it('never makes an unusable model the default the agent list falls back to', async () => {
    await saveCapabilities(t.db, t.workspaceId, {
      provider: 'codex',
      models: [MODELS[1]!, MODELS[0]!],
      efforts: EFFORTS,
      defaultModel: SOL_61,
      access: { reported: true, unlisted: [], account: CHATGPT },
    });
    expect((await capabilities()).defaultModel).toBe(SOL_61);
    await markModelRejected(t.db, t.workspaceId, 'codex', { id: SOL_61, label: 'GPT-6.1 Sol' });
    expect((await capabilities()).defaultModel).toBe('gpt-6-luna');
  });

  it('keeps an unlisted model out of routing while a confirmed one exists', async () => {
    await saveCapabilities(t.db, t.workspaceId, {
      provider: 'codex',
      models: MODELS,
      efforts: EFFORTS,
      defaultModel: SOL_61,
      access: { reported: true, unlisted: [SOL_61], account: CHATGPT },
    });
    const caps = await capabilities();
    expect(availability(caps)[SOL_61]).toBe('unknown');
    expect(caps.defaultModel).toBe('gpt-6-sol');
    const context = await loadIntakeContext(t.db, t.workspaceId, randomUUID());
    expect(context.candidates[0]?.models.map((model) => model.id)).toEqual([
      'gpt-6-luna',
      'gpt-6-sol',
    ]);
  });

  it('gives routing only usable models and names what was left out', async () => {
    startCodex();
    await send('Hello there');
    const context = await loadIntakeContext(t.db, t.workspaceId, randomUUID());
    expect(context.candidates[0]?.models.map((model) => model.id)).toEqual([
      'gpt-6-luna',
      'gpt-6-sol',
    ]);
    expect(context.leftOut?.codex).toEqual([{ id: SOL_61, label: 'GPT-6.1 Sol' }]);
    expect(context.defaultModels.codex).toBe('gpt-6-sol');
  });

  it('records availability as unknown for a provider that reports none', async () => {
    await saveCapabilities(t.db, t.workspaceId, {
      provider: 'codex',
      models: MODELS,
      efforts: EFFORTS,
      defaultModel: 'gpt-6-sol',
      access: { reported: false, unlisted: [] },
    });
    const caps = await capabilities();
    expect(new Set(Object.values(availability(caps)))).toEqual(new Set(['unknown']));
    expect(caps.access).toMatchObject({ reported: false, usable: 0, unknown: 3, checkedAt: null });
  });

  it('forgets learned rejections when the sign-in changes', async () => {
    startCodex();
    await send('Hello there');
    await recordAccount(t.db, t.workspaceId, 'codex', {
      kind: 'api_key',
      label: 'OpenAI API key',
      plan: null,
    });
    const caps = await capabilities();
    expect(availability(caps)[SOL_61]).toBe('unknown');
    expect(caps.access).toMatchObject({ signIn: 'Codex API key', unusable: [], reported: false });
  });
});

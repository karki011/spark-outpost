import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConversation } from '../src/persistence/conversations.ts';
import { FAKE_CLAUDE_MODES } from '../src/providers/fake.ts';
import { createProject } from '../src/projects/projects.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import { createTestApp, ORIGIN, LOCAL_HEADERS } from './app-support.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let probes = 0;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-chat-settings-')));
  probes = 0;
  app = createTestApp(t, {
    fixedRunProvider: null,
    probeCapabilities: async (provider) => {
      probes += 1;
      return {
        provider,
        models: [{ id: 'fast', label: 'Fast', description: 'Quick answers' }],
        efforts: [{ id: 'low', label: 'Low', description: null }],
        defaultModel: 'fast',
        modes: FAKE_CLAUDE_MODES,
        defaultMode: 'default',
        options: [
          {
            type: 'boolean' as const,
            id: 'fast',
            name: 'Fast mode',
            description: null,
            category: 'model_config',
            currentValue: false,
          },
        ],
      };
    },
  });
});

afterEach(async () => {
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

const send = (method: 'get' | 'patch' | 'post', path: string, body?: object) => {
  const call = request(app)[method](path).set(LOCAL_HEADERS).set('Origin', ORIGIN);
  return body ? call.send(body) : call;
};

describe('chat settings', () => {
  it('start from the default provider and override per chat without touching defaults', async () => {
    await connectCliProvider(t, 'claude');
    await connectCliProvider(t, 'codex');
    await updateProfile(t.db, t.workspaceId, { defaultProvider: 'claude' });
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);

    const initial = await send('get', `/api/conversations/${id}`).expect(200);
    expect(initial.body.settings).toEqual({
      provider: 'claude',
      model: null,
      effort: 'medium',
      permission: 'do',
      agentMode: 'default',
      level: 'hands-off',
      options: {},
      routing: 'pinned',
    });

    const switched = await send('patch', `/api/conversations/${id}/settings`, {
      provider: 'codex',
      model: 'gpt-6-sol',
    }).expect(200);
    expect(switched.body).toEqual({
      provider: 'codex',
      model: 'gpt-6-sol',
      effort: 'medium',
      permission: 'do',
      agentMode: 'agent',
      level: 'hands-off',
      options: {},
      routing: 'pinned',
    });

    const effort = await send('patch', `/api/conversations/${id}/settings`, {
      effort: 'high',
    }).expect(200);
    expect(effort.body).toMatchObject({ provider: 'codex', model: 'gpt-6-sol', effort: 'high' });

    const message = await send('post', `/api/conversations/${id}/messages`, {
      id: randomUUID(),
      content: 'Hi',
    }).expect(201);
    expect(message.body.run).toMatchObject({
      provider: 'codex',
      model: 'gpt-6-sol',
      effort: 'high',
    });

    const other = randomUUID();
    await createConversation(t.db, t.workspaceId, other);
    const fresh = await send('get', `/api/conversations/${other}`).expect(200);
    expect(fresh.body.settings.provider).toBe('claude');
  });

  it('sends the default model from the capability snapshot when the chat has none', async () => {
    await connectCliProvider(t, 'claude');
    await send('get', '/api/providers/claude/capabilities').expect(200);
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    const message = await send('post', `/api/conversations/${id}/messages`, {
      id: randomUUID(),
      content: 'Hi',
    }).expect(201);
    expect(message.body.run).toMatchObject({ provider: 'claude', model: 'fast' });

    await send('patch', `/api/conversations/${id}/settings`, { model: 'retired' }).expect(200);
    const retired = await send('post', `/api/conversations/${id}/messages`, {
      id: randomUUID(),
      content: 'Again',
    }).expect(201);
    expect(retired.body.run.model).toBe('fast');
  });

  it('lets a CLI provider pick a default model from its capability snapshot', async () => {
    await connectCliProvider(t, 'claude');
    await send('patch', '/api/providers/claude/defaults', { model: 'fast' }).expect(400);
    await send('get', '/api/providers/claude/capabilities').expect(200);
    await send('patch', '/api/providers/claude/defaults', { model: 'fast' }).expect(200);
    await send('patch', '/api/providers/claude/defaults', { model: 'nope' }).expect(400);
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    const detail = await send('get', `/api/conversations/${id}`).expect(200);
    expect(detail.body.settings).toMatchObject({ provider: 'claude', model: 'fast' });
  });

  it('remembers each provider’s choices when the chat switches back and forth', async () => {
    await connectCliProvider(t, 'claude');
    await connectCliProvider(t, 'codex');
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    const path = `/api/conversations/${id}/settings`;
    await send('patch', path, {
      model: 'sonnet',
      effort: 'max',
      agentMode: 'acceptEdits',
      level: 'balanced',
    }).expect(200);
    await send('patch', path, { provider: 'codex' }).expect(200);
    const codex = await send('patch', path, { model: 'gpt-6-sol', effort: 'high' }).expect(200);
    expect(codex.body).toEqual({
      provider: 'codex',
      model: 'gpt-6-sol',
      effort: 'high',
      permission: 'do',
      agentMode: 'agent',
      level: 'hands-off',
      options: {},
      routing: 'pinned',
    });
    const codexAsk = await send('patch', path, { agentMode: 'read-only' }).expect(200);
    expect(codexAsk.body).toMatchObject({
      provider: 'codex',
      agentMode: 'read-only',
      permission: 'ask',
    });
    const back = await send('patch', path, { provider: 'claude' }).expect(200);
    expect(back.body).toEqual({
      provider: 'claude',
      model: 'sonnet',
      effort: 'max',
      permission: 'do',
      agentMode: 'acceptEdits',
      level: 'balanced',
      options: {},
      routing: 'pinned',
    });
    const again = await send('patch', path, { provider: 'codex' }).expect(200);
    expect(again.body).toMatchObject({ model: 'gpt-6-sol', effort: 'high' });
    const reset = await send('patch', path, { model: null }).expect(200);
    expect(reset.body.model).toBeNull();
  });

  it('takes only modes and options the provider offers, and keeps the agent session when they change', async () => {
    await connectCliProvider(t, 'claude');
    await send('get', '/api/providers/claude/capabilities').expect(200);
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    const path = `/api/conversations/${id}/settings`;
    const bad = await send('patch', path, { agentMode: 'yolo' }).expect(400);
    expect(bad.body.error).toBe("Claude doesn't offer that mode.");
    await send('patch', path, { agentMode: 'bypassPermissions' }).expect(200);
    await send('patch', path, { options: { fast: 'maybe' } }).expect(400);
    const fast = await send('patch', path, { options: { fast: true } }).expect(200);
    expect(fast.body.options).toEqual({ fast: true });
    const planned = await send('patch', path, { agentMode: 'plan' }).expect(200);
    expect(planned.body).toMatchObject({ agentMode: 'plan', permission: 'ask' });
  });

  it('switches a running Do turn to the mode you pick, and a queued one before it starts', async () => {
    await connectCliProvider(t, 'claude');
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    const { project } = await createProject(t.db, t.workspaceId, root);
    await send('patch', `/api/conversations/${id}/settings`, { projectIds: [project.id] }).expect(
      200,
    );
    const first = await send('post', `/api/conversations/${id}/messages`, {
      id: randomUUID(),
      content: 'Build it',
    }).expect(201);
    await t.db.query(`UPDATE runs SET status = 'running' WHERE id = $1`, [first.body.run.id]);
    const second = await send('post', `/api/conversations/${id}/messages`, {
      id: randomUUID(),
      content: 'And this',
    }).expect(201);
    await send('patch', `/api/conversations/${id}/settings`, { agentMode: 'acceptEdits' }).expect(
      200,
    );
    const { rows } = await t.db.query<{
      id: string;
      agent_mode: string;
      requested_mode: string | null;
    }>('SELECT id, agent_mode, requested_mode FROM runs WHERE conversation_id = $1', [id]);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(first.body.run.id)).toMatchObject({
      agent_mode: 'default',
      requested_mode: 'acceptEdits',
    });
    expect(byId.get(second.body.run.id)).toMatchObject({
      agent_mode: 'acceptEdits',
      requested_mode: null,
    });
    const sessions = await t.db.query(
      'SELECT 1 FROM provider_sessions WHERE closed_at IS NOT NULL',
    );
    expect(sessions.rows).toEqual([]);
  });

  it('refuses a provider that is not connected', async () => {
    await connectCliProvider(t, 'claude');
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    const refused = await send('patch', `/api/conversations/${id}/settings`, {
      provider: 'codex',
    }).expect(400);
    expect(refused.body.error).toBe('Connect this provider before using it in a chat.');
  });
});

describe('provider capabilities', () => {
  it('probes once, then serves the cached snapshot until a refresh is asked for', async () => {
    await connectCliProvider(t, 'claude');
    const first = await send('get', '/api/providers/claude/capabilities').expect(200);
    expect(first.body).toMatchObject({ provider: 'claude', defaultModel: 'fast' });
    await send('get', '/api/providers/claude/capabilities').expect(200);
    expect(probes).toBe(1);
    await send('get', '/api/providers/claude/capabilities?refresh=1').expect(200);
    expect(probes).toBe(2);
    await send('get', '/api/providers/codex/capabilities').expect(400);
  });

  it('probes once more for a snapshot saved before modes were reported', async () => {
    await connectCliProvider(t, 'claude');
    await t.db.query(
      `INSERT INTO provider_capabilities (workspace_id, provider, models, efforts, default_model)
       VALUES ($1, 'claude', '[]', '[]', NULL)`,
      [t.workspaceId],
    );
    const first = await send('get', '/api/providers/claude/capabilities').expect(200);
    expect(first.body.modes.map((mode: { id: string }) => mode.id)).toContain('acceptEdits');
    await send('get', '/api/providers/claude/capabilities').expect(200);
    expect(probes).toBe(1);
  });
});

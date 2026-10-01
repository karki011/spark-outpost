import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { modeForLegacy, sparkAssistantSchema } from '@spark-outpost/contracts';
import { ASSISTANT_PREAMBLE } from '../src/companion/assistant.ts';
import { resolveChatSettings } from '../src/persistence/chat-settings.ts';
import type { Provider, ProviderTurn } from '../src/providers/provider.ts';
import { sparkToolsFor } from '../src/spark-mcp/server.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, localClient } from './app-support.ts';
import { connectCliProvider, createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker | null = null;
let turns: ProviderTurn[];

beforeEach(async () => {
  t = await createTestDb();
  turns = [];
  await connectCliProvider(t, 'claude');
  await connectCliProvider(t, 'codex');
  await t.db.query(
    `INSERT INTO profiles (workspace_id, display_name, default_provider, onboarding_completed_at)
     VALUES ($1, 'Test User', 'codex', now())`,
    [t.workspaceId],
  );
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
});

function recordingProvider(name: string): Provider {
  return {
    name,
    async *run(turn: ProviderTurn) {
      turns.push(turn);
      yield { kind: 'text_delta', delta: 'Nothing needs you right now.' };
    },
  };
}

function api() {
  return localClient(createTestApp(t, { fixedRunProvider: null }));
}

async function assistantId(): Promise<string> {
  const response = await api().send('post', '/api/spark-assistant');
  expect(response.status).toBe(200);
  return sparkAssistantSchema.parse(response.body).conversationId;
}

describe('Ask Spark', () => {
  it('keeps one read-only chat per user on the default provider, with no projects', async () => {
    const id = await assistantId();
    expect(await assistantId()).toBe(id);

    const settings = await resolveChatSettings(t.db, id);
    expect(settings.provider).toBe('codex');
    expect(settings.agentMode).toBe(modeForLegacy('codex', null, null));
    expect(settings.permission).toBe('ask');
    const { rows } = await t.db.query<{ title: string; projects: number }>(
      `SELECT title, (SELECT count(*) FROM conversation_projects WHERE conversation_id = $1)::int
         AS projects FROM conversations WHERE id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ title: 'Ask Spark', projects: 0 });

    await t.db.query(`UPDATE profiles SET default_provider = 'claude' WHERE workspace_id = $1`, [
      t.workspaceId,
    ]);
    expect(await assistantId()).toBe(id);
    expect((await resolveChatSettings(t.db, id)).provider).toBe('claude');
  });

  it('runs the turn with only the Spark read tools, no repo and no user MCP servers', async () => {
    const id = await assistantId();
    worker = startWorker({
      db: t.db,
      providers: new Map([['codex', recordingProvider('codex')]]),
      leaseSeconds: 30,
      concurrency: 1,
      pollMs: 20,
      cancelPollMs: 20,
    });

    const sent = await api().send('post', `/api/conversations/${id}/messages`, {
      id: randomUUID(),
      content: 'Does anyone need anything?',
    });
    expect(sent.status).toBe(201);
    expect(sent.body.run.provider).toBe('codex');

    const turn = await eventually(async () => turns[0]);
    expect(turn.sparkScope).toMatchObject({ conversationId: id, readOnly: true });
    expect(turn.projectRoots ?? []).toEqual([]);
    expect(turn.repo).toBeUndefined();
    expect(turn.userMcp).toBeUndefined();
    expect(turn.preamble).toBe(ASSISTANT_PREAMBLE);

    const tools = sparkToolsFor(turn.sparkScope!);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((tool) => tool.acts)).toBe(false);
    expect(sparkToolsFor({}).some((tool) => tool.acts)).toBe(true);
  });

  it('refuses before setup is finished', async () => {
    await t.db.query('DELETE FROM profiles WHERE workspace_id = $1', [t.workspaceId]);
    const response = await api().send('post', '/api/spark-assistant');
    expect(response.status).toBe(409);
  });
});

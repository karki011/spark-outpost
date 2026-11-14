import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BuilderChat, Teammate } from '@spark-outpost/contracts';
import { sweepBuilderChats } from '../src/crew-flows/builder-chat.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { createTeammate } from '../src/persistence/teammates.ts';
import { chatPromptFacts } from '../src/workflow/chat-turn-prompt.ts';
import { chatPrompt } from '../src/workflow/chat-prompt.ts';
import type { RunInput } from '../src/workflow/run-input.ts';
import { createTestApp, localClient } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let client: ReturnType<typeof localClient>;
let sparks: string;
let scribe: Teammate;

beforeEach(async () => {
  t = await createTestDb();
  sparks = await mkdtemp(join(tmpdir(), 'spark-builder-sparks-'));
  client = localClient(createTestApp(t, { deleteSettleMs: 1_000 }));
  scribe = await newSpark('Scribe');
});

afterEach(async () => {
  await t.cleanup();
  await rm(sparks, { recursive: true, force: true });
});

function newSpark(name: string): Promise<Teammate> {
  return createTeammate(
    t.db,
    t.workspaceId,
    {
      name,
      role: 'Release notes writer',
      provider: null,
      model: null,
      effort: null,
      agentMode: null,
      level: null,
      instructions: '',
      projectIds: [],
    },
    sparks,
  );
}

async function start(sparkId?: string): Promise<BuilderChat> {
  const body = sparkId ? { id: randomUUID(), sparkId } : { id: randomUUID() };
  return (await client.send('post', '/api/crew/builder', body).expect(201)).body as BuilderChat;
}

async function current(sparkId?: string): Promise<BuilderChat | null> {
  const path = sparkId ? `/api/crew/builder?spark=${sparkId}` : '/api/crew/builder';
  return ((await client.get(path).expect(200)).body as { chat: BuilderChat | null }).chat;
}

async function say(conversationId: string): Promise<string> {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: 'Add a changelog skill' },
    { provider: 'fake' },
    t.workspaceId,
  );
  await t.db.query('DELETE FROM jobs WHERE run_id = $1', [sent.run.id]);
  await t.db.query(`UPDATE runs SET status = 'succeeded', finished_at = now() WHERE id = $1`, [
    sent.run.id,
  ]);
  return sent.run.id;
}

describe('a builder chat beside one Spark', () => {
  it('is kept apart from the Sparks page chat and from other Sparks', async () => {
    const page = await start();
    const own = await start(scribe.id);
    const other = await start((await newSpark('Checker')).id);
    expect(own.sparkId).toBe(scribe.id);
    expect((await current())?.conversationId).toBe(page.conversationId);
    expect((await current(scribe.id))?.conversationId).toBe(own.conversationId);
    expect((await current(other.sparkId!))?.conversationId).toBe(other.conversationId);
    const { rows } = await t.db.query<{ title: string }>(
      'SELECT title FROM conversations WHERE id = $1',
      [own.conversationId],
    );
    expect(rows[0]?.title).toBe('Change Scribe');
  });

  it('has none until one is started, and refuses a Spark that does not exist', async () => {
    expect(await current(scribe.id)).toBeNull();
    await client
      .send('post', '/api/crew/builder', { id: randomUUID(), sparkId: randomUUID() })
      .expect(404);
  });

  it('tells the agent which Spark it changes and how to change files and folders', async () => {
    const { conversationId } = await start(scribe.id);
    const runId = await say(conversationId);
    const input = {
      identity: { threadId: conversationId, runId },
      workspaceId: t.workspaceId,
      projectRoots: [],
      level: 'hands-off',
      mode: 'do',
    } as unknown as RunInput;
    const facts = await chatPromptFacts(t.db, input);
    expect(facts.builderChat).toEqual({ spark: { id: scribe.id, name: 'Scribe' } });
    const prompt = chatPrompt(facts);
    expect(prompt).toContain(`beside the Scribe Spark (id ${scribe.id})`);
    expect(prompt).toContain('removeFolder');
  });

  it('is removed at the next sweep once its Spark is deleted', async () => {
    const own = await start(scribe.id);
    await t.db.query('DELETE FROM teammates WHERE id = $1', [scribe.id]);
    expect(await current(scribe.id)).toBeNull();
    expect(await sweepBuilderChats({ db: t.db, workspaceId: t.workspaceId })).toEqual([
      own.conversationId,
    ]);
    expect(await current()).toBeNull();
  });
});

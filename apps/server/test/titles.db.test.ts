import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Category } from '@spark-outpost/contracts';
import { createIntakeRecorder, type IntakeRecorder } from '../src/advisor/intake-recorder.ts';
import { runAdvice } from '../src/persistence/advice.ts';
import { conversationAuditRuns } from '../src/persistence/audit-summary.ts';
import { categoryUsage } from '../src/persistence/category-usage.ts';
import { updateConversation } from '../src/persistence/conversation-actions.ts';
import {
  createConversation,
  getConversationDetail,
  getSummary,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { createFakeProvider, FAKE_TITLE } from '../src/providers/fake.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker;
let intake: IntakeRecorder;
let jev: { category: Category; confidence: number } | null;

function jevFetch(): typeof fetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { questions: Record<string, unknown> };
    const choice = (value: string, confidence = 0.9) => ({
      type: 'choice',
      choice: value,
      probabilities: { [value]: confidence },
      confidence,
    });
    const answers: Record<string, unknown> = {
      intent: choice(jev!.category, jev!.confidence),
      complexity: { type: 'score', score: 1, confidence: 0.8 },
      risk: { type: 'score', score: 0, confidence: 0.8 },
      depth: choice('direct'),
    };
    for (const key of Object.keys(body.questions)) {
      if (key.startsWith('effort_')) answers[key] = { type: 'score', score: 0, confidence: 0.8 };
    }
    return new Response(JSON.stringify({ model: 'jev-1', answers, usage: { input_tokens: 10 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

beforeEach(async () => {
  t = await createTestDb();
  jev = null;
  await t.db.query(
    `INSERT INTO provider_connections
       (workspace_id, provider, method, detail, models, model, permission, effort, verified_at)
     VALUES ($1, 'claude', 'cli', 'claude test', $2, 'sonnet', 'ask', 'high', now())`,
    [t.workspaceId, JSON.stringify([{ id: 'sonnet', label: 'Sonnet 5' }])],
  );
  const provider = createFakeProvider({ stepMs: 0, wordMs: 0 });
  intake = createIntakeRecorder({
    db: t.db,
    secrets: memorySecretStore({ jev: 'fake-jev-key' }),
    fetch: jevFetch(),
    baseUrl: 'https://typesafe.test',
  });
  worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    concurrency: 1,
    pollMs: 20,
    cancelPollMs: 20,
    intake,
  });
});

afterEach(async () => {
  await worker.stop();
  await intake.settled();
  await t.cleanup();
});

async function connectJev(category: Category, confidence = 0.86) {
  jev = { category, confidence };
  await t.db.query(
    `INSERT INTO advisor_connections
       (workspace_id, advisor, method, detail, models, model, verified_at)
     VALUES ($1, 'jev', 'api_key', '…test', '[]', 'jev-latest', now())
     ON CONFLICT DO NOTHING`,
    [t.workspaceId],
  );
}

async function turn(conversationId: string, content: string) {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    { provider: 'fake' },
  );
  await eventually(async () => (await getRun(t.db, sent.run.id))?.finishedAt, 15_000);
  return sent.run.id;
}

async function newChat() {
  return (await createConversation(t.db, t.workspaceId, randomUUID())).id;
}

describe('auto titles', () => {
  it('replaces the message title with the agent title once, hiding the Title line', async () => {
    await connectJev('refactor');
    const id = await newChat();
    const runId = await turn(id, '#title move the date helpers');
    const detail = await getConversationDetail(t.db, id);
    expect(detail?.conversation).toMatchObject({
      title: FAKE_TITLE,
      titleSource: 'auto',
      category: 'refactor',
    });
    const reply = detail!.messages.find((message) => message.role === 'assistant')!;
    expect(reply.content).toContain('You wrote: "#title move the date helpers"');
    expect(reply.content).not.toMatch(/Title:/);
    expect((await runAdvice(t.db, runId))?.title).toEqual({ text: FAKE_TITLE, origin: 'agent' });

    await t.db.query(`UPDATE conversations SET title = 'Kept title' WHERE id = $1`, [id]);
    await turn(id, '#title one more thing');
    expect((await getSummary(t.db, id))?.title).toBe('Kept title');
  });

  it('retitles an auto title when a later turn is clearly a different task', async () => {
    await connectJev('refactor');
    const id = await newChat();
    await turn(id, 'Split src/format.ts into smaller files');
    expect(await getSummary(t.db, id)).toMatchObject({
      title: 'Refactor · format.ts',
      titleSource: 'auto',
    });
    jev = { category: 'docs', confidence: 0.9 };
    await turn(id, '#title document the helpers');
    expect(await getSummary(t.db, id)).toMatchObject({ title: FAKE_TITLE, category: 'docs' });
  });

  it('never renames a chat the user renamed, until they resume auto titles', async () => {
    await connectJev('feature');
    const id = await newChat();
    await turn(id, 'hello');
    const renamed = await updateConversation(t.db, t.workspaceId, id, { title: 'My name' });
    expect(renamed).toMatchObject({ title: 'My name', titleSource: 'user' });
    const runId = await turn(id, '#title add dark mode');
    expect(await getSummary(t.db, id)).toMatchObject({ title: 'My name', titleSource: 'user' });
    expect((await runAdvice(t.db, runId))?.title).toBeUndefined();

    const resumed = await updateConversation(t.db, t.workspaceId, id, { autoTitle: true });
    expect(resumed).toMatchObject({ title: 'My name', titleSource: 'message' });
    await turn(id, '#title add dark mode');
    expect(await getSummary(t.db, id)).toMatchObject({ title: FAKE_TITLE, titleSource: 'auto' });

    await updateConversation(t.db, t.workspaceId, id, { autoTitle: false });
    expect(await getSummary(t.db, id)).toMatchObject({ title: FAKE_TITLE, titleSource: 'user' });
  });

  it('keeps the message title and shows no category when Jev is unsure or absent', async () => {
    const offline = await newChat();
    await turn(offline, 'Split src/format.ts');
    expect(await getSummary(t.db, offline)).toMatchObject({
      title: 'Split src/format.ts',
      titleSource: 'message',
      category: null,
    });
    await connectJev('refactor', 0.3);
    const unsure = await newChat();
    const runId = await turn(unsure, 'Split src/format.ts');
    expect(await getSummary(t.db, unsure)).toMatchObject({
      titleSource: 'message',
      category: null,
    });
    expect((await getRun(t.db, runId))?.category).toBeNull();
  });
});

describe('turn categories', () => {
  it('stores the category per turn and breaks usage down by category', async () => {
    await connectJev('debugging');
    const id = await newChat();
    const first = await turn(id, 'why does the divider jump');
    jev = { category: 'chat', confidence: 0.9 };
    await turn(id, 'thanks!');
    expect((await getRun(t.db, first))?.category).toBe('debugging');
    expect((await getSummary(t.db, id))?.category).toBe('debugging');

    const runs = await conversationAuditRuns(t.db, id);
    expect(runs?.map((run) => run.category)).toEqual(['debugging', 'chat']);

    const usage = await categoryUsage(t.db, t.workspaceId);
    expect(usage.allTime).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'debugging', turns: 1, costSource: 'reported' }),
        expect.objectContaining({ category: 'chat', turns: 1 }),
      ]),
    );
    const debugging = usage.allTime.find((row) => row.category === 'debugging')!;
    expect(debugging.costUsd).toBeCloseTo(0.0042);
    expect(usage.last30Days).toHaveLength(2);
  });
});

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assistantHistorySchema, type AssistantHistory } from '@spark-outpost/contracts';
import { ensureAssistantChat } from '../src/companion/assistant.ts';
import { recordAssistantEvent } from '../src/companion/assistant-events.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { createTestApp, localClient } from './app-support.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let assistant: string;
let clock: number;

beforeEach(async () => {
  t = await createTestDb();
  await connectCliProvider(t, 'claude');
  await t.db.query(
    `INSERT INTO profiles (workspace_id, display_name, default_provider, onboarding_completed_at)
     VALUES ($1, 'Test User', 'claude', now())`,
    [t.workspaceId],
  );
  assistant = await ensureAssistantChat(t.db, t.workspaceId);
  clock = Date.parse('2026-10-18T09:00:00Z');
});

afterEach(async () => {
  await t.cleanup();
});

function tick(): Date {
  clock += 60_000;
  return new Date(clock);
}

async function chat(title: string): Promise<string> {
  const id = randomUUID();
  await t.db.query('INSERT INTO conversations (id, workspace_id, title) VALUES ($1, $2, $3)', [
    id,
    t.workspaceId,
    title,
  ]);
  return id;
}

interface Asked {
  question: string;
  answer?: string;
  status?: 'succeeded' | 'running' | 'failed';
  reads?: string[];
}

async function asked({ question, answer, status = 'succeeded', reads = [] }: Asked) {
  const messageId = randomUUID();
  const runId = randomUUID();
  await t.db.query(
    `INSERT INTO messages (id, conversation_id, role, content, created_at)
     VALUES ($1, $2, 'user', $3, $4)`,
    [messageId, assistant, question, tick()],
  );
  await t.db.query(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, created_at, mode)
     VALUES ($1, $2, $3, 'claude', $4, $5, 'ask')`,
    [runId, assistant, messageId, status, tick()],
  );
  for (const [index, chatRef] of reads.entries()) {
    const call = `call-${index}`;
    await t.db.query(
      `INSERT INTO run_events (run_id, seq, type, payload) VALUES
         ($1, $2, 'TOOL_CALL_START', $3), ($1, $2 + 1, 'TOOL_CALL_ARGS', $4)`,
      [
        runId,
        index * 2 + 1,
        JSON.stringify({ toolCallId: call, toolCallName: 'Reading a chat' }),
        JSON.stringify({ toolCallId: call, delta: JSON.stringify({ chat: chatRef }) }),
      ],
    );
  }
  if (answer !== undefined) {
    await t.db.query(
      `INSERT INTO messages (id, conversation_id, role, content, run_id, created_at)
       VALUES ($1, $2, 'assistant', $3, $4, $5)`,
      [randomUUID(), assistant, answer, runId, tick()],
    );
  }
  return { messageId, runId };
}

async function newTopic(): Promise<void> {
  await recordAssistantEvent(t.db, t.workspaceId, 'topic_started', null);
  await t.db.query(
    `UPDATE assistant_events SET at = $2 WHERE workspace_id = $1 AND kind = 'topic_started'
       AND at > now() - interval '1 minute'`,
    [t.workspaceId, tick()],
  );
}

async function history(query = ''): Promise<AssistantHistory> {
  const api = localClient(createTestApp(t, { fixedRunProvider: null }));
  const response = await api.get(`/api/spark-assistant/history${query}`);
  expect(response.status).toBe(200);
  return assistantHistorySchema.parse(response.body);
}

describe('Ask Spark history', () => {
  it('pages older questions with their answers, newest last, and places each divider once', async () => {
    await asked({ question: 'q1', answer: 'a1' });
    await asked({ question: 'q2', answer: 'a2' });
    await newTopic();
    await asked({ question: 'q3', answer: 'a3' });
    await asked({ question: 'q4', status: 'running' });

    const latest = await history('?limit=2');
    expect(latest.exchanges.map((entry) => [entry.question, entry.answer, entry.status])).toEqual([
      ['q3', 'a3', 'answered'],
      ['q4', null, 'waiting'],
    ]);
    expect(latest.topics).toEqual([]);
    expect(latest.older).toBe(latest.exchanges[0]!.id);

    const earlier = await history(`?limit=2&before=${latest.older}`);
    expect(earlier.exchanges.map((entry) => entry.question)).toEqual(['q1', 'q2']);
    expect(earlier.topics.map((topic) => topic.kind)).toEqual(['topic']);
    expect(earlier.older).toBeNull();

    const all = await history();
    expect(all.exchanges).toHaveLength(4);
    expect(all.topics).toHaveLength(1);
    const topicAt = Date.parse(all.topics[0]!.at);
    expect(Date.parse(all.exchanges[1]!.askedAt)).toBeLessThan(topicAt);
    expect(Date.parse(all.exchanges[2]!.askedAt)).toBeGreaterThan(topicAt);
  });

  it('marks a finished turn without a reply as failed', async () => {
    await asked({ question: 'q1', status: 'failed' });
    const { exchanges } = await history();
    expect(exchanges[0]).toMatchObject({ status: 'failed', answer: null });
  });

  it('returns nothing for an unknown cursor', async () => {
    await asked({ question: 'q1', answer: 'a1' });
    expect(await history(`?before=${randomUUID()}`)).toEqual({
      exchanges: [],
      topics: [],
      older: null,
    });
  });

  it('names the one chat an answer read as its source, by the id Spark recorded', async () => {
    const pipeline = await chat('CP-49259 session_activity POC');
    const other = await chat('Billing export');
    await asked({ question: 'single', answer: 'It changed 8 files.', reads: [pipeline] });
    await asked({
      question: 'link',
      answer: 'Read both.',
      reads: [`spark-outpost://chat/${pipeline}`, other],
    });
    await asked({ question: 'none', answer: 'Nothing read.', reads: [randomUUID(), assistant] });

    const { exchanges } = await history();
    expect(exchanges[0]!.source).toEqual({
      conversationId: pipeline,
      title: 'CP-49259 session_activity POC',
    });
    expect(exchanges[1]!.source).toBeNull();
    expect(exchanges[2]!.source).toBeNull();
  });

  it('links only chats Spark knows by title, never ids or addresses from the answer', async () => {
    const deploy = await chat('orders-web-app');
    const pipeline = await chat('pipeline-poc');
    await chat('Fix');
    const archived = await chat('Old archived work');
    await t.db.query('UPDATE conversations SET archived_at = now() WHERE id = $1', [archived]);
    const invented = randomUUID();
    await asked({
      question: 'Who needs me?',
      answer: [
        `**pipeline-poc** asks whether to deploy; **orders-web-app** wants to run a workflow.`,
        `Fix it at [this link](spark-outpost://chat/${invented}) or ${invented}.`,
        'Also see Old archived work and pipeline-pocket.',
      ].join('\n'),
    });

    const { exchanges } = await history();
    expect(exchanges[0]!.links).toEqual([
      { conversationId: pipeline, title: 'pipeline-poc' },
      { conversationId: deploy, title: 'orders-web-app' },
    ]);
  });

  it('shows New topic and Clear history dividers in the full conversation', async () => {
    await asked({ question: 'q1', answer: 'a1' });
    await newTopic();
    await recordAssistantEvent(t.db, t.workspaceId, 'history_cleared', 'key facts kept');
    const detail = await getConversationDetail(t.db, assistant);
    expect(detail?.topics?.map((topic) => topic.kind)).toEqual(['topic', 'cleared']);
    const plain = await chat('Plain chat');
    expect((await getConversationDetail(t.db, plain))?.topics).toBeUndefined();
  });
});

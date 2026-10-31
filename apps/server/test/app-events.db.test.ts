import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { EventType, SUBAGENTS_ACTIVITY, type AppEvent } from '@spark-outpost/contracts';
import { AppEventFeed, listenForAppEvents } from '../src/api/app-events.ts';
import {
  createConversation,
  listConversations,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { claimNextJob } from '../src/persistence/jobs.ts';
import { listen, type NotificationListener } from '../src/persistence/notifications.ts';
import { appendRunEvent } from '../src/persistence/run-events.ts';
import { createTestApp, LOCAL_HEADERS } from './app-support.ts';
import { createTestDb, eventually, testDatabaseUrl, type TestDb } from './support.ts';

interface Subscriber {
  status: number;
  events: AppEvent[];
  close(): void;
}

let t: TestDb;
let feed: AppEventFeed;
let listener: NotificationListener;
let server: http.Server;
const subscribers: Subscriber[] = [];

beforeEach(async () => {
  t = await createTestDb();
  feed = new AppEventFeed(2);
  listener = await listenForAppEvents(testDatabaseUrl(), feed);
  server = createTestApp(t, { appEvents: feed }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
});

afterEach(async () => {
  subscribers.splice(0).forEach((subscriber) => subscriber.close());
  await listener.close();
  await new Promise((resolve) => server.close(resolve));
  await t.cleanup();
});

function subscribe(): Promise<Subscriber> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const request = http.get(
      { host: '127.0.0.1', port, path: '/api/events', headers: LOCAL_HEADERS },
      (response) => {
        const subscriber: Subscriber = {
          status: response.statusCode ?? 0,
          events: [],
          close: () => request.destroy(),
        };
        let buffer = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          buffer += chunk;
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            const data = frame.split('\n').find((line) => line.startsWith('data: '));
            if (data) subscriber.events.push(JSON.parse(data.slice(6)) as AppEvent);
          }
        });
        subscribers.push(subscriber);
        resolve(subscriber);
      },
    );
    request.on('error', reject);
  });
}

async function startChat() {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  await sendUserMessage(
    t.db,
    conversation.id,
    { id: randomUUID(), content: 'hi' },
    {
      provider: 'fake',
    },
  );
  const lease = await claimNextJob(t.db, 30);
  if (!lease) throw new Error('No job to claim');
  return { conversationId: conversation.id, lease };
}

it('a run write sends a NOTIFY carrying only ids and kinds', async () => {
  const payloads: string[] = [];
  const raw = await listen(testDatabaseUrl(), 'changes', (payload) => payloads.push(payload));
  try {
    const { conversationId, lease } = await startChat();
    await appendRunEvent(
      t.db,
      lease,
      { type: EventType.STEP_STARTED, stepName: 'Reading the code' },
      { transition: { status: 'running' } },
    );
    const mine = await eventually(async () => {
      const parsed = payloads.map((payload) => JSON.parse(payload) as Record<string, unknown>);
      const found = parsed.filter((event) => event.conversationId === conversationId);
      return found.some((event) => event.kind === 'step') ? found : null;
    });
    expect(mine).toContainEqual({ kind: 'run', conversationId, runId: lease.runId });
    expect(mine).toContainEqual({
      kind: 'step',
      conversationId,
      runId: lease.runId,
      phase: 'started',
      step: 'Reading the code',
    });
    for (const event of mine.filter((item) => item.kind !== 'step'))
      expect(Object.keys(event).sort()).toEqual(['conversationId', 'kind', 'runId']);
  } finally {
    await raw.close();
  }
});

it('tells the app at once when a sub-agent starts or ends, and with the steps when the wait changes', async () => {
  const kinds: string[] = [];
  let conversationId = '';
  const raw = await listen(testDatabaseUrl(), 'changes', (payload) => {
    const event = JSON.parse(payload) as { kind: string; conversationId: string };
    const watched = event.kind === 'step' || event.kind === 'subagent';
    if (event.conversationId === conversationId && watched) kinds.push(event.kind);
  });
  try {
    const chat = await startChat();
    conversationId = chat.conversationId;
    const own = { subagentRunId: 's1' };
    await appendRunEvent(
      t.db,
      chat.lease,
      { type: EventType.SUBAGENT_STARTED, name: 'Explore', ...own },
      { transition: { status: 'running' } },
    );
    await appendRunEvent(t.db, chat.lease, {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: SUBAGENTS_ACTIVITY,
      activityType: SUBAGENTS_ACTIVITY,
      content: { waitingOn: 1 },
      replace: true,
    });
    await appendRunEvent(t.db, chat.lease, {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: 'other',
      activityType: 'other',
      content: {},
      replace: true,
    });
    await appendRunEvent(t.db, chat.lease, {
      type: EventType.SUBAGENT_ERROR,
      message: 'Stopped.',
      code: 'cancelled',
      ...own,
    });
    await appendRunEvent(t.db, chat.lease, {
      type: EventType.SUBAGENT_FINISHED,
      subagentRunId: 's2',
      outcome: { type: 'success' },
    });
    await eventually(async () => kinds.length >= 4);
    expect(kinds).toEqual(['subagent', 'step', 'subagent', 'subagent']);
  } finally {
    await raw.close();
  }
});

it("names the main agent's latest step in the chat list, not a sub-agent's", async () => {
  const { conversationId, lease } = await startChat();
  await appendRunEvent(
    t.db,
    lease,
    { type: EventType.STEP_STARTED, stepName: 'Reading the plan' },
    { transition: { status: 'running' } },
  );
  await appendRunEvent(t.db, lease, {
    type: EventType.STEP_STARTED,
    stepName: 'Read routes.ts',
    subagentRunId: 's1',
  });
  const chats = await listConversations(t.db, t.workspaceId);
  expect(chats.find((chat) => chat.id === conversationId)?.latestRun?.step).toBe(
    'Reading the plan',
  );
});

it('streams change events to every subscriber and refuses clients over the cap', async () => {
  const first = await subscribe();
  const second = await subscribe();
  const third = await subscribe();
  expect([first.status, second.status, third.status]).toEqual([200, 200, 503]);
  expect(feed.clientCount).toBe(2);

  const { conversationId, lease } = await startChat();
  await appendRunEvent(
    t.db,
    lease,
    { type: EventType.STEP_STARTED, stepName: 'Reading the code' },
    { transition: { status: 'running' } },
  );

  for (const subscriber of [first, second]) {
    const events = await eventually(async () => {
      const mine = subscriber.events.filter((event) => event.conversationId === conversationId);
      return mine.some((event) => event.kind === 'step') ? mine : null;
    });
    expect(events).toContainEqual({ kind: 'conversation', conversationId, runId: null });
    expect(events).toContainEqual({ kind: 'run', conversationId, runId: lease.runId });
  }

  first.close();
  await eventually(async () => feed.clientCount === 1);
  const again = await subscribe();
  expect(again.status).toBe(200);
});

it('ignores payloads that are not app events', async () => {
  await listener.close();
  const subscriber = await subscribe();
  feed.publish('{"kind":"secret","content":"hello"}');
  feed.publish('not json');
  feed.publish(JSON.stringify({ kind: 'digest', conversationId: null, runId: null }));
  await eventually(async () => subscriber.events.length === 1);
  expect(subscriber.events).toEqual([{ kind: 'digest', conversationId: null, runId: null }]);
});

it('closes subscribers while the database listener is down and refuses new ones', async () => {
  const subscriber = await subscribe();
  feed.setAvailable(false);
  expect(feed.clientCount).toBe(0);
  expect((await subscribe()).status).toBe(503);
  feed.setAvailable(true);
  expect((await subscribe()).status).toBe(200);
  subscriber.close();
});

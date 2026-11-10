import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chatTicketsSchema, ticketInboxSchema, type ChatTickets } from '@spark-outpost/contracts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { linkTicketForBuild } from '../src/tickets/chat-link.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { JIRA_EMAIL, JIRA_TOKEN } from './fake-jira.ts';
import { LINEAR_KEY } from './fake-linear.ts';
import { createTestDb, type TestDb } from './support.ts';
import { startTicketStubs, type TicketStubs } from './ticket-support.ts';

let t: TestDb;
let stubs: TicketStubs;
let secrets: SecretStore;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  stubs = await startTicketStubs();
  secrets = memorySecretStore();
  app = createTestApp(t, { secrets, fetch, linearApiUrl: stubs.linearUrl });
});

afterEach(async () => {
  await stubs.close();
  await t.cleanup();
});

const post = (url: string, body: object = {}) =>
  request(app).post(url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
const put = (url: string, body: object) =>
  request(app).put(url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
const get = (url: string) => request(app).get(url).set(LOCAL_HEADERS);

async function connectLinear() {
  await put('/api/tickets/connections/linear', { source: 'linear', apiKey: LINEAR_KEY }).expect(
    200,
  );
}

async function connectJira() {
  await put('/api/tickets/connections/jira', {
    source: 'jira',
    siteUrl: stubs.jiraUrl,
    email: JIRA_EMAIL,
    apiToken: JIRA_TOKEN,
  }).expect(200);
}

async function say(content: string, conversationId: string = randomUUID()) {
  await post(`/api/conversations/${conversationId}/messages`, { id: randomUUID(), content }).expect(
    201,
  );
  return conversationId;
}

async function build(content: string, conversationId?: string) {
  const chat = await say(content, conversationId);
  await linkTicketForBuild(t.db, {
    workspaceId: t.workspaceId,
    conversationId: chat,
    request: content,
    builds: true,
  });
  return chat;
}

async function chatTickets(conversationId: string): Promise<ChatTickets> {
  return chatTicketsSchema.parse((await get(`/api/conversations/${conversationId}/tickets`)).body);
}

const keysOf = (list: { key: string }[]) => list.map((ticket) => ticket.key);
const NOTHING = { linked: [], suggested: [], mentioned: [] };

describe('linking a chat to the ticket it works on', () => {
  it('links a build turn that fixes one ticket and shows the chat on the ticket', async () => {
    await connectLinear();
    const chat = await build('Fix the login bug in ENG-12');

    const linked = await chatTickets(chat);
    expect(linked.linked).toEqual([
      expect.objectContaining({ source: 'linear', key: 'ENG-12', title: expect.any(String) }),
    ]);
    expect(linked.suggested).toEqual([]);
    expect(linked.mentioned).toEqual([]);

    await connectJira();
    const inbox = ticketInboxSchema.parse(
      (await get('/api/tickets/inbox').set('Cache-Control', 'no-cache').expect(200)).body,
    );
    const ticket = inbox.tickets.find((item) => item.key === 'ENG-12')!;
    expect(ticket.chat).toMatchObject({ conversationId: chat });
    expect(ticket.work).toEqual([expect.objectContaining({ conversationId: chat, taskId: null })]);
    expect(stubs.linear.issues.find((i) => i.identifier === 'ENG-12')!.stateId).toBe('eng-todo');
  });

  it('only mentions a ticket that a message cites for analysis or as a reference', async () => {
    await connectLinear();
    const asked = await say('Analyse ENG-12 for me');
    expect(await chatTickets(asked)).toEqual({
      linked: [],
      suggested: [],
      mentioned: [expect.objectContaining({ key: 'ENG-12' })],
    });

    const analysed = await build('analyse ENG-12');
    const similar = await build('Similar to ENG-13, fix the signup form');
    for (const chat of [analysed, similar]) {
      const view = await chatTickets(chat);
      expect(view.linked).toEqual([]);
    }
    expect(keysOf((await chatTickets(similar)).suggested)).toEqual(['ENG-13']);

    const later = await say('Hello');
    await say('Now look at ENG-12', later);
    expect(keysOf((await chatTickets(later)).mentioned)).toEqual(['ENG-12']);
    await say('Thanks', later);
    expect(await chatTickets(later)).toEqual(NOTHING);
  });

  it('suggests instead of linking when a build names several tickets', async () => {
    await connectLinear();
    const chat = await build('Fix ENG-12 and ENG-13');
    const suggested = await chatTickets(chat);
    expect(suggested.linked).toEqual([]);
    expect(keysOf(suggested.suggested)).toEqual(['ENG-12', 'ENG-13']);

    const picked = chatTicketsSchema.parse(
      (await post(`/api/conversations/${chat}/tickets`, { source: 'linear', key: 'ENG-13' })).body,
    );
    expect(keysOf(picked.linked)).toEqual(['ENG-13']);
    expect(keysOf(picked.suggested)).toEqual(['ENG-12']);

    const dismissed = chatTicketsSchema.parse(
      (await post(`/api/conversations/${chat}/tickets/dismiss`).expect(200)).body,
    );
    expect(dismissed.linked).toEqual(picked.linked);
    expect(dismissed.suggested).toEqual([]);
    expect(keysOf(dismissed.mentioned)).toEqual(['ENG-12']);
  });

  it('does nothing for unknown keys or unconnected sources', async () => {
    const unconnected = await build('Fix ENG-12');
    expect(await chatTickets(unconnected)).toEqual(NOTHING);

    await connectLinear();
    const unknown = await build('Fix NOPE-404 and UTF-8');
    expect(await chatTickets(unknown)).toEqual(NOTHING);
    const { rows } = await t.db.query('SELECT * FROM conversation_tickets');
    expect(rows).toEqual([]);
  });

  it('reads Linear and Jira links, and ignores a Jira link to another site', async () => {
    await connectLinear();
    await connectJira();
    const linear = await build('https://linear.app/acme/issue/ENG-13/add-a-test');
    expect(keysOf((await chatTickets(linear)).linked)).toEqual(['ENG-13']);

    const jira = await build(`Work on ${stubs.jiraUrl}/browse/WEB-418`);
    expect((await chatTickets(jira)).linked).toEqual([
      expect.objectContaining({ source: 'jira', key: 'WEB-418' }),
    ]);

    const elsewhere = await build('Fix https://other.atlassian.net/browse/WEB-418');
    expect(await chatTickets(elsewhere)).toEqual(NOTHING);
  });

  it('keeps an unlink, even when a later build names the ticket again', async () => {
    await connectLinear();
    const chat = await build('Fix ENG-12');
    const unlinked = chatTicketsSchema.parse(
      (
        await post(`/api/conversations/${chat}/tickets/unlink`, {
          source: 'linear',
          key: 'ENG-12',
        }).expect(200)
      ).body,
    );
    expect(unlinked.linked).toEqual([]);

    await build('Fix ENG-12', chat);
    const again = await chatTickets(chat);
    expect(again.linked).toEqual([]);
    expect(again.suggested).toEqual([]);
    expect(keysOf(again.mentioned)).toEqual(['ENG-12']);
  });

  it('keeps a Start work chat on its ticket without suggesting its subtasks', async () => {
    await connectLinear();
    const chat = randomUUID();
    await post('/api/tickets/linear/ENG-12/start', {
      conversationId: chat,
      messageId: randomUUID(),
      moveToInProgress: false,
    }).expect(201);
    const { rows } = await t.db.query<{ content: string }>(
      'SELECT content FROM messages WHERE conversation_id = $1',
      [chat],
    );
    expect(rows[0]!.content).toContain('ENG-12');
    await linkTicketForBuild(t.db, {
      workspaceId: t.workspaceId,
      conversationId: chat,
      request: `${rows[0]!.content}\n\nSubtasks: ENG-13`,
      builds: true,
    });
    const view = await chatTickets(chat);
    expect(keysOf(view.linked)).toEqual(['ENG-12']);
    expect(view.suggested).toEqual([]);
    expect(view.mentioned).toEqual([]);
  });

  it('refuses to link a ticket the source does not have', async () => {
    await connectLinear();
    const chat = await say('Hello');
    await post(`/api/conversations/${chat}/tickets`, { source: 'linear', key: 'ENG-999' }).expect(
      404,
    );
    await post(`/api/conversations/${randomUUID()}/tickets`, {
      source: 'linear',
      key: 'ENG-12',
    }).expect(404);
  });
});

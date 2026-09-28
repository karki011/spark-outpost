import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  startTicketResponseSchema,
  ticketConnectionsSchema,
  ticketListSchema,
  ticketViewSchema,
} from '@spark-outpost/contracts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { syncTicketsAfterShip } from '../src/tickets/ship-sync.ts';
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

const send = (method: 'put' | 'patch' | 'post' | 'delete', url: string, body: object = {}) =>
  request(app)[method](url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
const get = (url: string) => request(app).get(url).set(LOCAL_HEADERS);

async function connectLinear() {
  const response = await send('put', '/api/tickets/connections/linear', {
    source: 'linear',
    apiKey: LINEAR_KEY,
  }).expect(200);
  return ticketConnectionsSchema.parse(response.body);
}

async function connectJira() {
  const response = await send('put', '/api/tickets/connections/jira', {
    source: 'jira',
    siteUrl: `${stubs.jiraUrl}/`,
    email: JIRA_EMAIL,
    apiToken: JIRA_TOKEN,
  }).expect(200);
  return ticketConnectionsSchema.parse(response.body);
}

async function events() {
  const { rows } = await t.db.query<{ action: string; outcome: string; ticket_key: string | null }>(
    'SELECT action, outcome, ticket_key FROM ticket_events ORDER BY at, id',
  );
  return rows.map((row) => [row.action, row.outcome, row.ticket_key]);
}

async function startTicket(source: string, key: string, body: object = {}) {
  const conversationId = randomUUID();
  const messageId = randomUUID();
  const response = await send('post', `/api/tickets/${source}/${key}/start`, {
    conversationId,
    messageId,
    ...body,
  }).expect(201);
  return { ...startTicketResponseSchema.parse(response.body), messageId };
}

describe('ticket connections', () => {
  it('validates, stores the key only in the keychain, and removes it', async () => {
    const saved = await connectLinear();
    expect(saved.connections).toEqual([
      expect.objectContaining({
        source: 'linear',
        account: 'alex@example.test',
        siteUrl: null,
        keySaved: true,
        moveOnShip: true,
        statusMap: {},
      }),
    ]);
    expect(await secrets.get('ticket:linear')).toBe(LINEAR_KEY);
    const jira = await connectJira();
    expect(jira.connections.map((c) => [c.source, c.siteUrl])).toEqual([
      ['jira', stubs.jiraUrl],
      ['linear', null],
    ]);

    const dump = await t.db.query<{ text: string }>(
      `SELECT concat_ws(' ', (SELECT json_agg(c) FROM ticket_connections c),
         (SELECT json_agg(e) FROM ticket_events e)) AS text`,
    );
    expect(dump.rows[0]!.text).not.toContain(LINEAR_KEY);
    expect(dump.rows[0]!.text).not.toContain(JIRA_TOKEN);

    const removed = await send('delete', '/api/tickets/connections/linear').expect(200);
    expect(ticketConnectionsSchema.parse(removed.body).connections.map((c) => c.source)).toEqual([
      'jira',
    ]);
    expect(await secrets.get('ticket:linear')).toBeNull();
    expect(await events()).toEqual([
      ['connect', 'succeeded', null],
      ['connect', 'succeeded', null],
      ['disconnect', 'succeeded', null],
    ]);
  });

  it('refuses a rejected key without saving anything', async () => {
    const response = await send('put', '/api/tickets/connections/linear', {
      source: 'linear',
      apiKey: 'lin_api_wrong_0123456789abcdefghij',
    }).expect(400);
    expect(response.body.error).toContain('Linear rejected this key');
    expect(await secrets.get('ticket:linear')).toBeNull();
    expect((await get('/api/tickets/connections').expect(200)).body).toEqual({ connections: [] });
    expect(await events()).toEqual([['connect', 'failed', null]]);
  });

  it('rejects plain-http Jira sites and a body for another source', async () => {
    await send('put', '/api/tickets/connections/jira', {
      source: 'jira',
      siteUrl: 'http://example.atlassian.net',
      email: JIRA_EMAIL,
      apiToken: JIRA_TOKEN,
    }).expect(400);
    await send('put', '/api/tickets/connections/jira', {
      source: 'linear',
      apiKey: LINEAR_KEY,
    }).expect(400);
  });

  it('saves settings and asks to connect first', async () => {
    await send('patch', '/api/tickets/connections/linear', { moveOnShip: false }).expect(409);
    await connectLinear();
    const changed = await send('patch', '/api/tickets/connections/linear', {
      moveOnShip: false,
      statusMap: { OPS: { in_review: 'Doing' } },
    }).expect(200);
    expect(ticketConnectionsSchema.parse(changed.body).connections[0]).toMatchObject({
      moveOnShip: false,
      statusMap: { OPS: { in_review: 'Doing' } },
    });
    await send('patch', '/api/tickets/connections/linear', {}).expect(400);
  });
});

describe('tickets', () => {
  it('lists assigned tickets from every source and reports a failing one', async () => {
    expect((await get('/api/tickets').expect(200)).body).toEqual({ tickets: [], errors: [] });
    await connectLinear();
    await connectJira();
    const list = ticketListSchema.parse((await get('/api/tickets').expect(200)).body);
    expect(list.tickets.map((ticket) => ticket.key)).toEqual([
      'WEB-418',
      'ENG-12',
      'OPS-4',
      'API-77',
      'ENG-13',
      'WEB-419',
    ]);
    const filtered = ticketListSchema.parse(
      (await get('/api/tickets?source=jira&project=WEB&status=in_progress').expect(200)).body,
    );
    expect(filtered.tickets.map((ticket) => ticket.key)).toEqual(['WEB-419']);
    await get('/api/tickets?status=later').expect(400);

    const cached = await t.db.query('SELECT key FROM tickets ORDER BY key');
    expect(cached.rows).toHaveLength(6);

    await secrets.set('ticket:jira', 'jira_revoked_token_000000');
    const partial = ticketListSchema.parse((await get('/api/tickets').expect(200)).body);
    expect(partial.tickets.every((ticket) => ticket.source === 'linear')).toBe(true);
    expect(partial.errors).toEqual([
      { source: 'jira', message: expect.stringContaining('Jira rejected the saved credentials') },
    ]);
  });

  it('shows a ticket with its detail and asks to connect when needed', async () => {
    await get('/api/tickets/linear/ENG-12').expect(409);
    await connectLinear();
    const view = ticketViewSchema.parse((await get('/api/tickets/linear/ENG-12').expect(200)).body);
    expect(view.ticket).toMatchObject({ key: 'ENG-12', comments: [{ author: 'Sam' }] });
    expect(view.work).toEqual([]);
    await get('/api/tickets/linear/ENG-999').expect(404);
    await get('/api/tickets/linear/not a key').expect(400);
  });

  it('starts a chat from a ticket, links it, and moves it to In progress', async () => {
    await connectJira();
    const started = await startTicket('jira', 'WEB-418', { mode: 'plan' });
    expect(started.transition).toEqual({ outcome: 'succeeded', message: null });
    expect(started.ticket).toMatchObject({ key: 'WEB-418', status: 'todo' });
    expect(stubs.jira.issues.find((issue) => issue.key === 'WEB-418')!.status).toBe('In Progress');

    const detail = (await get(`/api/conversations/${started.conversationId}`).expect(200)).body;
    expect(detail.conversation.title).toContain('WEB-418');
    const message = detail.messages.find((m: { role: string }) => m.role === 'user');
    expect(message.content).toContain('## Acceptance criteria\n\n- A Download CSV button');
    expect(message.content).toContain('Start by proposing a plan');
    expect(detail.runs[0].id).toBe(started.runId);
    const task = detail.tasks.find((entry: { id: string }) => entry.id === started.taskId);
    expect(task.title).toBe('WEB-418: Export the usage table as CSV');
    const taskDetail = (await get(`/api/tasks/${started.taskId}`).expect(200)).body;
    expect(taskDetail.links).toEqual([
      expect.objectContaining({
        kind: 'link',
        source: 'ticket',
        url: `${stubs.jiraUrl}/browse/WEB-418`,
        title: 'WEB-418: Export the usage table as CSV',
      }),
    ]);

    const list = ticketListSchema.parse((await get('/api/tickets?source=jira').expect(200)).body);
    const listed = list.tickets.find((ticket) => ticket.key === 'WEB-418')!;
    expect(listed.status).toBe('in_progress');
    expect(listed.work).toEqual([
      expect.objectContaining({
        taskId: started.taskId,
        conversationId: started.conversationId,
        pullRequests: [],
      }),
    ]);
    expect(await events()).toEqual([
      ['connect', 'succeeded', null],
      ['start', 'succeeded', 'WEB-418'],
      ['transition', 'succeeded', 'WEB-418'],
    ]);
  });

  it('treats a repeated start as the same chat and leaves the status alone when asked', async () => {
    await connectLinear();
    const conversationId = randomUUID();
    const body = { conversationId, messageId: randomUUID(), moveToInProgress: false };
    const first = await send('post', '/api/tickets/linear/ENG-12/start', body).expect(201);
    const again = await send('post', '/api/tickets/linear/ENG-12/start', body).expect(201);
    expect(again.body.taskId).toBe(first.body.taskId);
    expect(again.body.runId).toBe(first.body.runId);
    expect(first.body.transition).toBeNull();
    expect(stubs.linear.issues[0]!.stateId).toBe('eng-todo');
    const other = await send('post', '/api/tickets/linear/OPS-4/start', {
      ...body,
      messageId: randomUUID(),
    }).expect(409);
    expect(other.body.error).toBe('Start work on a ticket in a new chat.');
  });

  it('links a shipped draft PR and moves the ticket to In review', async () => {
    await connectLinear();
    const started = await startTicket('linear', 'ENG-12');
    const pull = { url: 'https://github.com/acme/widgets/pull/9', title: 'acme/widgets#9' };
    await syncTicketsAfterShip(
      { db: t.db, workspaceId: t.workspaceId, secrets, fetch },
      started.taskId,
      pull,
    );
    const issue = stubs.linear.issues[0]!;
    expect(issue.attachments).toEqual([pull]);
    expect(issue.stateId).toBe('eng-review');
    const cached = await t.db.query<{ status: string }>(
      `SELECT status FROM tickets WHERE key = 'ENG-12'`,
    );
    expect(cached.rows[0]!.status).toBe('in_review');
  });

  it('respects the switch, reports a missing state, and never fails the ship', async () => {
    await connectLinear();
    const eng = await startTicket('linear', 'ENG-12');
    const ops = await startTicket('linear', 'OPS-4');
    const deps = { db: t.db, workspaceId: t.workspaceId, secrets, fetch };
    await syncTicketsAfterShip(deps, ops.taskId, {
      url: 'https://github.com/acme/ops/pull/1',
      title: 'acme/ops#1',
    });
    const opsIssue = stubs.linear.issues.find((issue) => issue.identifier === 'OPS-4')!;
    expect(opsIssue.stateId).toBe('ops-doing');
    const skipped = await t.db.query<{ outcome: string; detail: { message: string } }>(
      `SELECT outcome, detail FROM ticket_events WHERE ticket_key = 'OPS-4' AND action = 'transition'
       ORDER BY at DESC LIMIT 1`,
    );
    expect(skipped.rows[0]).toMatchObject({ outcome: 'skipped' });
    expect(skipped.rows[0]!.detail.message).toContain('No status maps to In review in OPS');

    await send('patch', '/api/tickets/connections/linear', { moveOnShip: false }).expect(200);
    await syncTicketsAfterShip(deps, eng.taskId, {
      url: 'https://github.com/acme/widgets/pull/3',
      title: 'acme/widgets#3',
    });
    expect(stubs.linear.issues[0]!.stateId).toBe('eng-progress');
    expect(stubs.linear.issues[0]!.attachments).toHaveLength(1);

    await secrets.delete('ticket:linear');
    await expect(
      syncTicketsAfterShip(deps, eng.taskId, {
        url: 'https://github.com/acme/widgets/pull/4',
        title: 'x',
      }),
    ).resolves.toBeUndefined();
    await expect(
      syncTicketsAfterShip(deps, randomUUID(), { url: 'https://x.test', title: 'x' }),
    ).resolves.toBeUndefined();
  });

  it('moves and comments on request', async () => {
    await connectJira();
    const moved = await send('post', '/api/tickets/jira/WEB-419/transition', {
      status: 'in_review',
    }).expect(200);
    expect(moved.body).toEqual({ outcome: 'succeeded', message: null });
    const back = await send('post', '/api/tickets/jira/WEB-419/transition', {
      status: 'in_progress',
    }).expect(200);
    expect(back.body.outcome).toBe('skipped');
    await send('post', '/api/tickets/jira/WEB-419/comments', { body: 'On it.' }).expect(201);
    await send('post', '/api/tickets/jira/WEB-419/comments', { body: '' }).expect(400);
    expect(stubs.jira.issues.find((issue) => issue.key === 'WEB-419')!.comments).toHaveLength(1);
  });
});

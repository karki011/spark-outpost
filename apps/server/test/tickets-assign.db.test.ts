import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assignTicketResponseSchema, ticketSearchSchema } from '@spark-outpost/contracts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { JIRA_EMAIL, JIRA_TOKEN } from './fake-jira.ts';
import { LINEAR_KEY } from './fake-linear.ts';
import { createTestDb, type TestDb } from './support.ts';
import { startTicketStubs, type TicketStubs } from './ticket-support.ts';

let t: TestDb;
let stubs: TicketStubs;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  stubs = await startTicketStubs();
  app = createTestApp(t, { secrets: memorySecretStore(), fetch, linearApiUrl: stubs.linearUrl });
});

afterEach(async () => {
  await stubs.close();
  await t.cleanup();
});

const send = (method: 'put' | 'post', url: string, body: object = {}) =>
  request(app)[method](url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
const get = (url: string) => request(app).get(url).set(LOCAL_HEADERS);

async function connect() {
  await send('put', '/api/tickets/connections/linear', {
    source: 'linear',
    apiKey: LINEAR_KEY,
  }).expect(200);
  await send('put', '/api/tickets/connections/jira', {
    source: 'jira',
    siteUrl: stubs.jiraUrl,
    email: JIRA_EMAIL,
    apiToken: JIRA_TOKEN,
  }).expect(200);
}

const assign = (source: string, key: string, body: object) =>
  send('post', `/api/tickets/${source}/${key}/assign`, body);
const linearAssignee = (key: string) =>
  stubs.linear.issues.find((issue) => issue.identifier === key)!.assigneeId;

describe('ticket search', () => {
  it('searches every connected source and says whose each ticket is', async () => {
    await connect();
    const found = ticketSearchSchema.parse(
      (await get('/api/tickets/search?q=upload').expect(200)).body,
    );
    expect(found.tickets.map((ticket) => [ticket.key, ticket.mine]).toSorted()).toEqual([
      ['API-95', false],
      ['ENG-16', false],
      ['WEB-437', false],
    ]);
    const mine = ticketSearchSchema.parse(
      (await get('/api/tickets/search?assignee=me&source=linear').expect(200)).body,
    );
    expect(mine.tickets.every((ticket) => ticket.mine)).toBe(true);
    expect(mine.tickets.map((ticket) => ticket.key)).toEqual(['ENG-12', 'OPS-4', 'ENG-13']);
    await get('/api/tickets/search?assignee=nobody').expect(400);
  });

  it('keeps results from one source when the other fails', async () => {
    await connect();
    await t.db.query(`UPDATE ticket_connections SET api_url = 'http://127.0.0.1:9'
      WHERE source = 'jira'`);
    const found = ticketSearchSchema.parse(
      (await get('/api/tickets/search?q=upload').expect(200)).body,
    );
    expect(found.tickets.map((ticket) => ticket.key)).toEqual(['ENG-16']);
    expect(found.errors).toEqual([
      expect.objectContaining({ source: 'jira', kind: 'unreachable' }),
    ]);
  });
});

describe('assign to me', () => {
  it('assigns an unassigned ticket in one step and undoes it', async () => {
    await connect();
    const assigned = assignTicketResponseSchema.parse(
      (await assign('linear', 'ENG-16', { to: 'me', expectedAssigneeId: null }).expect(200)).body,
    );
    expect(assigned.previous).toBeNull();
    expect(assigned.ticket.assignedTo).toEqual({ id: 'user-1', name: 'Alex Example' });
    expect(linearAssignee('ENG-16')).toBe('user-1');

    await assign('linear', 'ENG-16', { to: null, expectedAssigneeId: 'user-1' }).expect(200);
    expect(linearAssignee('ENG-16')).toBeNull();
    const { rows } = await t.db.query<{ outcome: string }>(
      `SELECT outcome FROM ticket_events WHERE action = 'assign' ORDER BY at`,
    );
    expect(rows.map((row) => row.outcome)).toEqual(['succeeded', 'succeeded']);
  });

  it('asks to confirm before taking a ticket from someone else, then gives it back', async () => {
    await connect();
    const refused = await assign('linear', 'ENG-15', { to: 'me' }).expect(409);
    expect(refused.body.error).toContain('ENG-15 is assigned to Jordan Lee');
    expect(linearAssignee('ENG-15')).toBe('user-2');

    const taken = assignTicketResponseSchema.parse(
      (
        await assign('linear', 'ENG-15', {
          to: 'me',
          expectedAssigneeId: 'user-2',
          confirmTakeover: true,
        }).expect(200)
      ).body,
    );
    expect(taken.previous).toEqual({ id: 'user-2', name: 'Jordan Lee' });
    expect(linearAssignee('ENG-15')).toBe('user-1');

    await assign('linear', 'ENG-15', {
      to: taken.previous,
      expectedAssigneeId: 'user-1',
    }).expect(200);
    expect(linearAssignee('ENG-15')).toBe('user-2');
  });

  it('refuses when the assignee changed since the list was loaded', async () => {
    await connect();
    const stale = await assign('linear', 'ENG-15', {
      to: 'me',
      expectedAssigneeId: null,
      confirmTakeover: true,
    }).expect(409);
    expect(stale.body.error).toContain("it's now assigned to Jordan Lee");
    expect(linearAssignee('ENG-15')).toBe('user-2');
  });

  it("explains Jira's permission error and records it", async () => {
    await connect();
    stubs.jira.denyAssign.add('API');
    const denied = await assign('jira', 'API-95', { to: 'me' }).expect(409);
    expect(denied.body.error).toBe(
      "Jira says you can't assign issues in API. Ask a project admin for the Assign issues permission. Nothing changed.",
    );
    const { rows } = await t.db.query<{ outcome: string }>(
      `SELECT outcome FROM ticket_events WHERE action = 'assign'`,
    );
    expect(rows.map((row) => row.outcome)).toEqual(['failed']);
    await assign('jira', 'API-95', { to: 'someone' }).expect(400);
  });
});

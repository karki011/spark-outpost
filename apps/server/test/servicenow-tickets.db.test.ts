import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ticketConnectionsSchema,
  ticketInboxSchema,
  ticketSearchSchema,
  ticketViewSchema,
} from '@spark-outpost/contracts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { warmMentionedTickets } from '../src/tickets/mention-cache.ts';
import { createTestApp, localClient } from './app-support.ts';
import { JIRA_EMAIL, JIRA_TOKEN } from './fake-jira.ts';
import { SERVICENOW_PASSWORD, SERVICENOW_USER } from './fake-servicenow.ts';
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

const send = (method: 'put' | 'patch' | 'post', url: string, body: object = {}) =>
  localClient(app).send(method, url, body);
const get = (url: string) => localClient(app).get(url);

async function connect() {
  const response = await send('put', '/api/tickets/connections/servicenow', {
    source: 'servicenow',
    instanceUrl: stubs.serviceNowUrl,
    authKind: 'basic',
    username: SERVICENOW_USER,
    password: SERVICENOW_PASSWORD,
  }).expect(200);
  return ticketConnectionsSchema.parse(response.body);
}

const record = (number: string) => stubs.servicenow.records.find((row) => row.number === number)!;
const keysOf = (tickets: { key: string }[]) => tickets.map((ticket) => ticket.key).sort();

describe('ServiceNow tickets', () => {
  it('fills the inbox with my records, and my groups’ unassigned ones by default', async () => {
    const connections = await connect();
    const connection = connections.connections.find((entry) => entry.source === 'servicenow');
    expect(connection).toMatchObject({ moveOnShip: false, moveOnMerge: false });
    expect(connection?.servicenow?.inboxScope).toBe('groups');
    const inbox = ticketInboxSchema.parse(
      (await get('/api/tickets/inbox').set('Cache-Control', 'no-cache').expect(200)).body,
    );
    expect(keysOf(inbox.tickets)).toEqual([
      'CHG0030012',
      'INC0010023',
      'INC0010027',
      'INC0010031',
      'PRB0040007',
      'SCTASK0010051',
    ]);
    const vpn = inbox.tickets.find((ticket) => ticket.key === 'INC0010023')!;
    expect(vpn).toMatchObject({ statusName: 'In Progress', priorityRank: 2, project: 'incident' });

    await send('patch', '/api/tickets/connections/servicenow', { inboxScope: 'me' }).expect(200);
    const mine = ticketInboxSchema.parse(
      (await get('/api/tickets/inbox').set('Cache-Control', 'no-cache').expect(200)).body,
    );
    expect(keysOf(mine.tickets)).not.toContain('SCTASK0010051');
  });

  it('keeps the inbox when one of the request tables is denied', async () => {
    await connect();
    stubs.servicenow.denied.add('sc_task');
    const inbox = ticketInboxSchema.parse(
      (await get('/api/tickets/inbox').set('Cache-Control', 'no-cache').expect(200)).body,
    );
    expect(inbox.errors).toEqual([]);
    expect(keysOf(inbox.tickets)).toContain('INC0010023');
    expect(keysOf(inbox.tickets)).not.toContain('SCTASK0010051');
    await get('/api/tickets/servicenow/INC0010027').expect(200);
  });

  it('leaves a type out of the inbox when its switch is off', async () => {
    await connect();
    await send('patch', '/api/tickets/connections/servicenow', {
      serviceNowTypes: { change: false, problem: false },
    }).expect(200);
    const inbox = ticketInboxSchema.parse(
      (await get('/api/tickets/inbox').set('Cache-Control', 'no-cache').expect(200)).body,
    );
    expect(keysOf(inbox.tickets)).not.toContain('CHG0030012');
    expect(keysOf(inbox.tickets)).not.toContain('PRB0040007');
    await get('/api/tickets/servicenow/CHG0030012').expect(404);
  });

  it('searches by words or number and reports a rate limit per source', async () => {
    await connect();
    const found = ticketSearchSchema.parse(
      (await get('/api/tickets/search?q=wi-fi&assignee=anyone').expect(200)).body,
    );
    expect(found.tickets.map((ticket) => ticket.key)).toEqual(['INC0010040']);
    const byNumber = ticketSearchSchema.parse(
      (await get('/api/tickets/search?q=inc0010027&assignee=anyone').expect(200)).body,
    );
    expect(byNumber.tickets.map((ticket) => ticket.key)).toEqual(['INC0010027']);
    stubs.servicenow.limited = 10;
    const limited = ticketInboxSchema.parse(
      (await get('/api/tickets/inbox').set('Cache-Control', 'no-cache').expect(200)).body,
    );
    expect(limited.errors).toEqual([
      expect.objectContaining({
        source: 'servicenow',
        message: expect.stringContaining('ServiceNow is limiting requests (429)'),
      }),
    ]);
  });

  it('shows work notes and comments apart, with attachments, and falls back to the record', async () => {
    await connect();
    const view = ticketViewSchema.parse(
      (await get('/api/tickets/servicenow/INC0010023').expect(200)).body,
    );
    expect(view.ticket.description).toContain('GlobalProtect');
    expect(view.ticket.comments.map((entry) => [entry.visibility, entry.body])).toEqual([
      ['internal', 'Reproduced on a test laptop.'],
      ['customer', 'It dropped again at 10:20.'],
      ['internal', 'Gateway idle timeout is 1200 s. Matches the drop interval.'],
    ]);
    expect(view.ticket.attachments).toEqual([{ name: 'vpn-client.log', bytes: 24_576 }]);
    stubs.servicenow.denied.add('sys_journal_field');
    const fallback = ticketViewSchema.parse(
      (await get('/api/tickets/servicenow/INC0010023').expect(200)).body,
    );
    expect(fallback.ticket.comments.map((entry) => entry.visibility).sort()).toEqual([
      'customer',
      'internal',
      'internal',
    ]);
  });

  it('posts a work note by default and a caller comment only when asked', async () => {
    await connect();
    await send('post', '/api/tickets/servicenow/INC0010023/comments', {
      body: 'Raised to 8 h.',
    }).expect(201);
    await send('post', '/api/tickets/servicenow/INC0010023/comments', {
      body: 'We found the cause.',
      visibility: 'customer',
    }).expect(201);
    expect(stubs.servicenow.writes.map((write) => write.body)).toEqual([
      { work_notes: 'Raised to 8 h.' },
      { comments: 'We found the cause.' },
    ]);
    await send('post', '/api/tickets/servicenow/CHG0030012/comments', { body: 'x' }).expect(409);
  });

  it('moves to a state that is not final and refuses resolve, close and cancel', async () => {
    await connect();
    const held = await send('post', '/api/tickets/servicenow/INC0010031/transition', {
      status: 'in_progress',
    }).expect(200);
    expect(held.body).toMatchObject({ outcome: 'succeeded' });
    expect(record('INC0010031').state).toBe('2');
    for (const status of ['in_review', 'done']) {
      const refused = await send('post', '/api/tickets/servicenow/INC0010023/transition', {
        status,
      }).expect(200);
      expect(refused.body).toMatchObject({
        outcome: 'failed',
        message: expect.stringContaining('resolving, closing or cancelling tells the caller'),
      });
    }
    expect(record('INC0010023').state).toBe('2');
    stubs.servicenow.denied.add('sys_choice');
    const blind = await send('post', '/api/tickets/servicenow/INC0010027/transition', {
      status: 'in_progress',
    }).expect(200);
    expect(blind.body.message).toContain("can't read the incident states");
  });

  it('assigns to me and keeps changes read only', async () => {
    await connect();
    await send('post', '/api/tickets/servicenow/SCTASK0010051/assign', { to: 'me' }).expect(200);
    expect(record('SCTASK0010051').assigned_to).toBe('6816f79cc0a8016401c5a33be04be441');
    await send('post', '/api/tickets/servicenow/CHG0030012/assign', { to: null }).expect(409);
  });

  it('refuses ship and merge moves for ServiceNow', async () => {
    await connect();
    await send('patch', '/api/tickets/connections/servicenow', { moveOnShip: true }).expect(409);
    await send('patch', '/api/tickets/connections/jira', { inboxScope: 'me' }).expect(409);
  });

  it('looks a bare record number up in ServiceNow only, never in Jira', async () => {
    await connect();
    await send('put', '/api/tickets/connections/jira', {
      source: 'jira',
      siteUrl: stubs.jiraUrl,
      email: JIRA_EMAIL,
      apiToken: JIRA_TOKEN,
    }).expect(200);
    const asked: string[] = [];
    const spy: typeof fetch = (input, init) => {
      asked.push(String(input));
      return fetch(input, init);
    };
    await warmMentionedTickets(
      { db: t.db, workspaceId: t.workspaceId, secrets, fetch: spy },
      'Please look at INC0010027 today',
    );
    expect(asked.some((url) => url.startsWith(stubs.jiraUrl))).toBe(false);
    expect(asked.some((url) => url.startsWith(stubs.serviceNowUrl))).toBe(true);
    const { rows } = await t.db.query<{ source: string; key: string }>(
      'SELECT source, key FROM tickets WHERE key = $1',
      ['INC0010027'],
    );
    expect(rows).toEqual([{ source: 'servicenow', key: 'INC0010027' }]);
  });
});

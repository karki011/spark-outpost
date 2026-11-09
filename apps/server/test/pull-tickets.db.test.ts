import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { findTrackedPull } from '../src/persistence/tracked-pulls.ts';
import { pollWatch } from '../src/pr-follow-up/poller.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { syncPullTickets, syncRecordedPull } from '../src/tickets/ship-sync.ts';
import { createTestApp, localClient } from './app-support.ts';
import { fakeFeedbackGitHub } from './fake-github-feedback.ts';
import { JIRA_EMAIL, JIRA_TOKEN } from './fake-jira.ts';
import { SERVICENOW_PASSWORD, SERVICENOW_USER } from './fake-servicenow.ts';
import { followUpDeps } from './pr-follow-up-support.ts';
import { syncShipped, trackShipped } from './pull-ticket-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { startTicketStubs, type TicketStubs } from './ticket-support.ts';

let t: TestDb;
let stubs: TicketStubs;
let secrets: SecretStore;
let app: ReturnType<typeof createTestApp>;

const PULL = 'https://github.com/acme/widgets/pull/5';
const ADDRESS = { host: 'github.com', owner: 'acme', repo: 'widgets', number: 5 };

beforeEach(async () => {
  t = await createTestDb();
  stubs = await startTicketStubs();
  secrets = memorySecretStore();
  app = createTestApp(t, { secrets, fetch });
  await send('put', '/api/tickets/connections/jira', {
    source: 'jira',
    siteUrl: stubs.jiraUrl,
    email: JIRA_EMAIL,
    apiToken: JIRA_TOKEN,
  }).expect(200);
});

afterEach(async () => {
  await stubs.close();
  await t.cleanup();
});

const send = (method: 'put' | 'patch' | 'post', url: string, body: object = {}) =>
  localClient(app).send(method, url, body);
const deps = () => ({ db: t.db, workspaceId: t.workspaceId, secrets, fetch });
const jiraStatus = (key: string) => stubs.jira.issues.find((issue) => issue.key === key)!.status;

async function plainChat(): Promise<string> {
  const conversationId = randomUUID();
  await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: 'Fix the uploads' },
    { provider: 'fake' },
    t.workspaceId,
  );
  return conversationId;
}

async function startWork(source: string, key: string) {
  const response = await send('post', `/api/tickets/${source}/${key}/start`, {
    conversationId: randomUUID(),
    messageId: randomUUID(),
  }).expect(201);
  return response.body as { taskId: string };
}

async function reviewMoves() {
  const { rows } = await t.db.query<{ source: string; ticket_key: string; outcome: string }>(
    `SELECT source, ticket_key, outcome FROM ticket_events
     WHERE action = 'transition' AND detail->>'target' = 'in_review' ORDER BY at, id`,
  );
  return rows.map((row) => ({ source: row.source, key: row.ticket_key, outcome: row.outcome }));
}

async function approvals(): Promise<number> {
  const { rows } = await t.db.query<{ count: string }>('SELECT count(*) FROM approvals');
  return Number(rows[0]!.count);
}

describe('the ticket a pull request names', () => {
  it('moves a ticket whose key is in the pull request title, without a card', async () => {
    const conversationId = await plainChat();
    const synced = await syncShipped(deps(), null, {
      url: PULL,
      conversationId,
      title: 'WEB-437: Resume large uploads',
    });

    expect(synced).toEqual([
      { source: 'jira', key: 'WEB-437', outcome: 'succeeded', message: null },
    ]);
    expect(jiraStatus('WEB-437')).toBe('Code Review');
    expect(await approvals()).toBe(0);
    const pull = await findTrackedPull(t.db, t.workspaceId, ADDRESS);
    expect(pull?.ticketSync).toEqual(synced);
  });

  it('moves a known ticket whose key is in the branch, in any case', async () => {
    await localClient(app).get('/api/tickets/inbox').expect(200);
    const conversationId = await plainChat();
    await syncShipped(deps(), null, {
      url: PULL,
      conversationId,
      branch: 'spark/web-418-fix-uploads',
    });

    expect(jiraStatus('WEB-418')).toBe('Code Review');
  });

  it('moves nothing when no connected ticket is named', async () => {
    const conversationId = await plainChat();
    const synced = await syncShipped(deps(), null, {
      url: PULL,
      conversationId,
      branch: 'spark/web-437-fix-2',
      title: 'Tidy FIX-9000 notes',
    });

    expect(synced).toEqual([]);
    expect(jiraStatus('WEB-437')).toBe('To Do');
    expect(await reviewMoves()).toEqual([]);
  });

  it('moves the ticket the chat started from and the one named, once per pull request', async () => {
    const { taskId } = await startWork('jira', 'WEB-418');
    const pull = await trackShipped(deps(), taskId, { url: PULL, title: 'Also WEB-437' });
    const [first, second] = await Promise.all([
      syncPullTickets(deps(), pull),
      syncPullTickets(deps(), pull),
    ]);
    await syncRecordedPull(deps(), ADDRESS);

    expect([first, second].filter((entry) => entry !== null)).toHaveLength(1);
    expect(jiraStatus('WEB-418')).toBe('Code Review');
    expect(jiraStatus('WEB-437')).toBe('Code Review');
    expect(await reviewMoves()).toEqual([
      { source: 'jira', key: 'WEB-418', outcome: 'succeeded' },
      { source: 'jira', key: 'WEB-437', outcome: 'succeeded' },
    ]);
  });

  it('keeps the claim across a restart and never moves a terminal or discovery sighting', async () => {
    const conversationId = await plainChat();
    await syncShipped(deps(), null, { url: PULL, conversationId, title: 'WEB-437' });
    const reread = await findTrackedPull(t.db, t.workspaceId, ADDRESS);
    expect(await syncPullTickets(deps(), reread!)).toBeNull();

    const found = await syncShipped(deps(), null, {
      url: 'https://github.com/acme/widgets/pull/6',
      conversationId,
      title: 'WEB-418',
      via: 'discovery',
    });
    expect(found).toBeNull();
    expect(jiraStatus('WEB-418')).toBe('To Do');
  });

  it('reports a move that failed or was left, and the pull request carries on', async () => {
    const conversationId = await plainChat();
    const left = await syncShipped(deps(), null, { url: PULL, conversationId, title: 'WEB-420' });
    expect(left).toEqual([
      expect.objectContaining({ key: 'WEB-420', outcome: 'skipped', message: expect.any(String) }),
    ]);

    const { taskId } = await startWork('jira', 'WEB-418');
    await stubs.close();
    const failed = await syncShipped(deps(), taskId, {
      url: 'https://github.com/acme/widgets/pull/8',
    });
    expect(failed).toEqual([expect.objectContaining({ key: 'WEB-418', outcome: 'failed' })]);
    expect(await reviewMoves()).toContainEqual({
      source: 'jira',
      key: 'WEB-418',
      outcome: 'failed',
    });
    expect(await approvals()).toBe(0);
    stubs = await startTicketStubs();
  });

  it('moves the ticket when the poller first sees an agent-opened pull request', async () => {
    const conversationId = await plainChat();
    await trackShipped(deps(), null, {
      url: 'https://github.com/acme/widgets/pull/7',
      conversationId,
      title: 'WEB-437 resume',
      via: 'agent',
    });
    const pull = await findTrackedPull(t.db, t.workspaceId, { ...ADDRESS, number: 7 });
    const base = followUpDeps(t, fakeFeedbackGitHub(), []);
    const polled = await pollWatch({ ...base, github: { ...base.github, secrets } }, pull!);

    expect(polled.lastError).toBeNull();
    expect(jiraStatus('WEB-437')).toBe('Code Review');
  });

  it('keeps polling and following the pull request when the ticket source is down', async () => {
    const { taskId } = await startWork('jira', 'WEB-418');
    const tracked = await trackShipped(deps(), taskId, {
      url: 'https://github.com/acme/widgets/pull/7',
      via: 'agent',
    });
    await stubs.close();
    const base = followUpDeps(t, fakeFeedbackGitHub(), []);
    const polled = await pollWatch({ ...base, github: { ...base.github, secrets } }, tracked);

    expect(polled).toMatchObject({ lastError: null, phase: 'watching', prState: 'open' });
    const after = await findTrackedPull(t.db, t.workspaceId, { ...ADDRESS, number: 7 });
    expect(after?.ticketSync).toEqual([
      expect.objectContaining({ key: 'WEB-418', outcome: 'failed' }),
    ]);
    expect(await approvals()).toBe(0);
    stubs = await startTicketStubs();
  });
});

describe('ServiceNow when a pull request opens', () => {
  it('never moves a ServiceNow record, started from or named', async () => {
    await send('put', '/api/tickets/connections/servicenow', {
      source: 'servicenow',
      instanceUrl: stubs.serviceNowUrl,
      authKind: 'basic',
      username: SERVICENOW_USER,
      password: SERVICENOW_PASSWORD,
    }).expect(200);
    await send('patch', '/api/tickets/connections/servicenow', { moveOnShip: true }).expect(409);
    const before = stubs.servicenow.records.find((row) => row.number === 'INC0010023')!.state;
    const { taskId } = await startWork('servicenow', 'INC0010023');
    const synced = await syncShipped(deps(), taskId, { url: PULL, title: 'INC0010027 fix' });

    expect(synced).toEqual([]);
    expect(await reviewMoves()).toEqual([]);
    expect(stubs.servicenow.records.find((row) => row.number === 'INC0010023')!.state).toBe(before);
  });
});

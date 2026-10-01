import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  attentionSettingsSchema,
  ticketInboxSchema,
  type TicketInbox,
} from '@spark-outpost/contracts';
import { saveGitHubToken } from '../src/persistence/github-tokens.ts';
import { addTaskLink } from '../src/persistence/tasks.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { JIRA_EMAIL, JIRA_TOKEN } from './fake-jira.ts';
import { LINEAR_KEY } from './fake-linear.ts';
import { startGitHubStub, type GitHubStub } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { startTicketStubs, type TicketStubs } from './ticket-support.ts';

let t: TestDb;
let stubs: TicketStubs;
let github: GitHubStub;
let secrets: SecretStore;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  stubs = await startTicketStubs();
  github = await startGitHubStub();
  secrets = memorySecretStore();
  app = createTestApp(t, {
    secrets,
    fetch,
    linearApiUrl: stubs.linearUrl,
    githubApiUrl: github.url,
  });
});

afterEach(async () => {
  await github.close();
  await stubs.close();
  await t.cleanup();
});

const send = (method: 'put' | 'patch' | 'post', url: string, body: object = {}) =>
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

async function inbox(): Promise<TicketInbox> {
  return ticketInboxSchema.parse((await get('/api/tickets/inbox').expect(200)).body);
}

const sectionOf = (list: TicketInbox, key: string) =>
  list.tickets.find((ticket) => ticket.key === key)?.section;

async function backdateAssigned(key: string, days: number) {
  await t.db.query(
    `UPDATE tickets SET first_seen_assigned_at = now() - make_interval(days => $2) WHERE key = $1`,
    [key, days],
  );
}

async function linkPull(key: string, url: string) {
  const conversationId = randomUUID();
  await send('post', `/api/tickets/linear/${key}/start`, {
    conversationId,
    messageId: randomUUID(),
    moveToInProgress: false,
  }).expect(201);
  const { rows } = await t.db.query<{ task_id: string }>(
    'SELECT task_id FROM task_tickets WHERE ticket_key = $1',
    [key],
  );
  await addTaskLink(t.db, rows[0]!.task_id, { kind: 'pr', url, title: url, source: 'ship' });
}

async function connectGitHubToken() {
  await secrets.set('github', 'ghp_test_token');
  await saveGitHubToken(t.db, t.workspaceId, {
    host: 'github.com',
    login: 'octo-token',
    scopes: ['repo'],
    expiresAt: null,
    repos: [],
  });
}

function fakePull(number: number, fields: Record<string, unknown>) {
  github.github.pulls.push({
    number,
    owner: 'acme',
    repo: 'widgets',
    title: 'Fix',
    body: '',
    head: `fix-${number}`,
    base: 'main',
    draft: false,
    state: 'open',
    html_url: `https://github.com/acme/widgets/pull/${number}`,
    openedBy: 'octo-token',
    via: 'token',
    ...fields,
  });
}

describe('tickets inbox', () => {
  it('is empty until a source is connected', async () => {
    const empty = await inbox();
    expect(empty).toMatchObject({ tickets: [], errors: [], sources: [] });
    expect(empty.settings).toMatchObject({ idleDays: 2, dueDays: 2, reviewDays: 3 });
  });

  it('sorts your tickets into sections with the reasons the rules found', async () => {
    await connect();
    stubs.jira.issues.find((issue) => issue.key === 'WEB-418')!.priority = 'Highest';
    const tomorrow = new Date(Date.now() + 24 * 3_600_000);
    stubs.linear.issues.find((issue) => issue.identifier === 'OPS-4')!.dueDate = [
      tomorrow.getFullYear(),
      String(tomorrow.getMonth() + 1).padStart(2, '0'),
      String(tomorrow.getDate()).padStart(2, '0'),
    ].join('-');
    await inbox();
    await backdateAssigned('WEB-418', 3);
    const list = await inbox();
    expect(list.sources.toSorted()).toEqual(['jira', 'linear']);
    const attention = list.tickets.filter((ticket) => ticket.section === 'attention');
    expect(attention.map((ticket) => [ticket.key, ticket.reason])).toEqual([
      ['WEB-418', 'Urgent · not started'],
      ['OPS-4', 'Due tomorrow'],
    ]);
    expect(attention[0]!.flags[0]!.rationale).toContain('2 days ago or more');
    expect(sectionOf(list, 'ENG-13')).toBe('working');
    expect(sectionOf(list, 'WEB-419')).toBe('working');
    expect(sectionOf(list, 'ENG-12')).toBe('up_next');
    expect(sectionOf(list, 'ENG-14')).toBe('done');
    expect(sectionOf(list, 'WEB-420')).toBe('done');

    const { rows } = await t.db.query<{ items: { itemId: string }[] }>(
      'SELECT items FROM attention_snapshots',
    );
    expect(rows[0]!.items.map((item) => item.itemId)).toEqual([
      'ticket:jira:WEB-418',
      'ticket:linear:OPS-4',
    ]);
  });

  it('uses the thresholds from the attention settings', async () => {
    await connect();
    stubs.jira.issues.find((issue) => issue.key === 'WEB-418')!.priority = 'High';
    await inbox();
    await backdateAssigned('WEB-418', 3);
    expect(sectionOf(await inbox(), 'WEB-418')).toBe('attention');
    const saved = await send('patch', '/api/tickets/attention-settings', { idleDays: 5 }).expect(
      200,
    );
    expect(attentionSettingsSchema.parse(saved.body).idleDays).toBe(5);
    expect(sectionOf(await inbox(), 'WEB-418')).toBe('up_next');
    await send('patch', '/api/tickets/attention-settings', { idleDays: 0 }).expect(400);
    await send('patch', '/api/tickets/attention-settings', {}).expect(400);
  });

  it('reports a rejected token as an auth problem and keeps the other source', async () => {
    await connect();
    await secrets.set('ticket:jira', 'jira_revoked_token_000000');
    const list = await inbox();
    expect(list.errors).toEqual([expect.objectContaining({ source: 'jira', kind: 'auth' })]);
    expect(list.tickets.every((ticket) => ticket.source === 'linear')).toBe(true);
  });

  it('reads linked pull requests and moves a merged one to Done unless switched off', async () => {
    await connect();
    await connectGitHubToken();
    fakePull(1, { draft: true });
    await linkPull('ENG-12', 'https://github.com/acme/widgets/pull/1');
    const drafted = (await inbox()).tickets.find((ticket) => ticket.key === 'ENG-12')!;
    expect(drafted).toMatchObject({ section: 'pr_ready', reason: 'Draft PR #1' });
    expect(drafted.pullRequest).toMatchObject({ repo: 'acme/widgets', number: 1, state: 'draft' });
    expect(drafted.chat?.state).toBe('running');

    const pull = github.github.pulls[0]!;
    pull.draft = false;
    pull.reviews = [{ user: { login: 'sam' }, state: 'CHANGES_REQUESTED' }];
    expect((await inbox()).tickets.find((ticket) => ticket.key === 'ENG-12')).toMatchObject({
      section: 'attention',
      reason: 'PR #1 changes requested',
    });

    await send('patch', '/api/tickets/connections/linear', { moveOnMerge: false }).expect(200);
    pull.merged = true;
    pull.state = 'closed';
    const kept = (await inbox()).tickets.find((ticket) => ticket.key === 'ENG-12')!;
    expect(kept).toMatchObject({ section: 'working', reason: 'PR #1 merged' });
    expect(stubs.linear.issues.find((i) => i.identifier === 'ENG-12')!.stateId).toBe('eng-todo');

    await send('patch', '/api/tickets/connections/linear', { moveOnMerge: true }).expect(200);
    const moved = (await inbox()).tickets.find((ticket) => ticket.key === 'ENG-12')!;
    expect(moved.section).toBe('done');
    expect(stubs.linear.issues.find((i) => i.identifier === 'ENG-12')!.stateId).toBe('eng-done');
    await inbox();
    const { rows } = await t.db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ticket_events
       WHERE action = 'transition' AND detail->>'mergedPullRequest' IS NOT NULL`,
    );
    expect(rows[0]!.count).toBe(1);
  });

  it('reads the check runs of a linked pull request', async () => {
    await connect();
    await connectGitHubToken();
    fakePull(1, {});
    await linkPull('ENG-12', 'https://github.com/acme/widgets/pull/1');
    const checks = async () =>
      (await inbox()).tickets.find((ticket) => ticket.key === 'ENG-12')!.pullRequest?.checks;
    expect(await checks()).toBeNull();

    const pull = github.github.pulls[0]!;
    pull.checkRuns = [
      { status: 'completed', conclusion: 'success' },
      { status: 'in_progress', conclusion: null },
    ];
    expect(await checks()).toBe('pending');
    pull.checkRuns[1] = { status: 'completed', conclusion: 'failure' };
    expect(await checks()).toBe('failing');
    pull.checkRuns[1] = { status: 'completed', conclusion: 'skipped' };
    expect(await checks()).toBe('passing');
  });

  it('shows Not available when the pull request cannot be read', async () => {
    await connect();
    await linkPull('ENG-12', 'https://github.com/acme/widgets/pull/9');
    const item = (await inbox()).tickets.find((ticket) => ticket.key === 'ENG-12')!;
    expect(item).toMatchObject({ section: 'pr_ready', reason: 'PR opened', pullRequest: null });
  });
});

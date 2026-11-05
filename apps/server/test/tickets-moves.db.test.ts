import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ticketConnectionsSchema,
  ticketInboxSchema,
  ticketMoveOptionsSchema,
} from '@spark-outpost/contracts';
import { saveGitHubToken } from '../src/persistence/github-tokens.ts';
import { addTaskLink } from '../src/persistence/tasks.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { syncTicketsAfterShip } from '../src/tickets/ship-sync.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { JIRA_EMAIL, JIRA_TOKEN } from './fake-jira.ts';
import { startGitHubStub, type GitHubStub } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { startTicketStubs, type TicketStubs } from './ticket-support.ts';

let t: TestDb;
let stubs: TicketStubs;
let github: GitHubStub;
let secrets: SecretStore;
let app: ReturnType<typeof createTestApp>;

const PULL = 'https://github.com/acme/widgets/pull/1';

beforeEach(async () => {
  t = await createTestDb();
  stubs = await startTicketStubs();
  github = await startGitHubStub();
  secrets = memorySecretStore();
  app = createTestApp(t, { secrets, fetch, githubApiUrl: github.url });
  await send('put', '/api/tickets/connections/jira', {
    source: 'jira',
    siteUrl: stubs.jiraUrl,
    email: JIRA_EMAIL,
    apiToken: JIRA_TOKEN,
  }).expect(200);
});

afterEach(async () => {
  await github.close();
  await stubs.close();
  await t.cleanup();
});

const send = (method: 'put' | 'patch' | 'post', url: string, body: object = {}) =>
  request(app)[method](url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
const get = (url: string) => request(app).get(url).set(LOCAL_HEADERS);
const jiraIssue = (key: string) => stubs.jira.issues.find((issue) => issue.key === key)!;
const jiraStatus = (key: string) => jiraIssue(key).status;
const saveMoves = (moveStatuses: object) =>
  send('patch', '/api/tickets/connections/jira', { moveStatuses }).expect(200);

function finishedStatuses(...names: string[]) {
  stubs.jira.workflows.WEB = {
    'To Do': 'new',
    'In Progress': 'indeterminate',
    'Code Review': 'indeterminate',
    ...Object.fromEntries(names.map((name) => [name, 'done' as const])),
  };
  jiraIssue('WEB-420').status = names[0]!;
}

async function moves(key: string) {
  const { rows } = await t.db.query<{ outcome: string; detail: Record<string, unknown> }>(
    `SELECT outcome, detail FROM ticket_events WHERE action = 'transition' AND ticket_key = $1
     ORDER BY at, id`,
    [key],
  );
  return rows.map((row) => ({ outcome: row.outcome, ...row.detail }));
}

async function startWork(key: string, moveToInProgress: boolean) {
  const response = await send('post', `/api/tickets/jira/${key}/start`, {
    conversationId: randomUUID(),
    messageId: randomUUID(),
    moveToInProgress,
  }).expect(201);
  return response.body as { taskId: string; transition: unknown };
}

async function mergedPullFor(key: string) {
  await secrets.set('github', 'ghp_test_token');
  await saveGitHubToken(t.db, t.workspaceId, {
    host: 'github.com',
    login: 'octo-token',
    scopes: ['repo'],
    expiresAt: null,
    repos: [],
  });
  github.github.pulls.push({
    number: 1,
    owner: 'acme',
    repo: 'widgets',
    title: 'Fix',
    body: '',
    head: 'fix-1',
    base: 'main',
    draft: false,
    state: 'closed',
    merged: true,
    html_url: PULL,
    openedBy: 'octo-token',
    via: 'token',
  });
  const { taskId } = await startWork(key, false);
  await addTaskLink(t.db, taskId, { kind: 'pr', url: PULL, title: PULL, source: 'ship' });
}

const inboxTicket = async (key: string) =>
  ticketInboxSchema
    .parse((await get('/api/tickets/inbox').expect(200)).body)
    .tickets.find((ticket) => ticket.key === key)!;

describe('the merged pull request move', () => {
  it('moves to Done, not Rejected, and records from, to and the rule', async () => {
    finishedStatuses('Rejected', 'Done');
    await mergedPullFor('WEB-418');

    expect(await inboxTicket('WEB-418')).toMatchObject({ status: 'done', statusName: 'Done' });
    expect(jiraStatus('WEB-418')).toBe('Done');
    expect(await moves('WEB-418')).toEqual([
      {
        outcome: 'succeeded',
        mergedPullRequest: PULL,
        target: 'done',
        from: 'To Do',
        to: 'Done',
        rule: 'name',
        message: null,
      },
    ]);
  });

  it('leaves the ticket and flags it when only Rejected is there', async () => {
    finishedStatuses('Rejected');
    await mergedPullFor('WEB-418');
    await inboxTicket('WEB-418');
    const flagged = await inboxTicket('WEB-418');

    expect(jiraStatus('WEB-418')).toBe('To Do');
    expect(flagged.lastSync).toMatchObject({
      action: 'transition',
      outcome: 'failed',
      message:
        'WEB-418 was not moved: Spark never picks Rejected on its own. Choose a status in Settings → Connectors → Jira.',
    });
    expect(flagged.flags.map((flag) => flag.rule)).toContain('sync-failed');
    expect(await moves('WEB-418')).toEqual([
      expect.objectContaining({ outcome: 'failed', from: 'To Do', to: null, rule: 'blocked' }),
    ]);
  });

  it('uses the status chosen in settings', async () => {
    finishedStatuses('Shipped', 'Released');
    const saved = await saveMoves({ done: 'Released' });
    expect(ticketConnectionsSchema.parse(saved.body).connections[0]!.moveStatuses).toEqual({
      done: 'Released',
    });
    await mergedPullFor('WEB-418');

    expect(await inboxTicket('WEB-418')).toMatchObject({ statusName: 'Released' });
    expect(await moves('WEB-418')).toEqual([
      expect.objectContaining({ outcome: 'succeeded', to: 'Released', rule: 'setting' }),
    ]);
  });
});

describe('the review and start-work moves', () => {
  it('moves to the review status by name when a pull request opens', async () => {
    const { taskId } = await startWork('WEB-418', true);
    await syncTicketsAfterShip({ db: t.db, workspaceId: t.workspaceId, secrets, fetch }, taskId, {
      url: PULL,
      title: 'acme/widgets#1',
    });

    expect(jiraStatus('WEB-418')).toBe('Code Review');
    expect(await moves('WEB-418')).toEqual([
      expect.objectContaining({ target: 'in_progress', from: 'To Do', to: 'In Progress' }),
      expect.objectContaining({ target: 'in_review', from: 'In Progress', to: 'Code Review' }),
    ]);
  });

  it('does not move on Start work when the in-progress status is unclear', async () => {
    stubs.jira.workflows.WEB = {
      'To Do': 'new',
      Blocked: 'indeterminate',
      Building: 'indeterminate',
      Testing: 'indeterminate',
      Done: 'done',
    };
    jiraIssue('WEB-419').status = 'Testing';
    const started = await startWork('WEB-418', true);

    expect(started.transition).toEqual({
      outcome: 'failed',
      message:
        'WEB-418 was not moved: this project has several in-progress statuses (Blocked, Building, Testing). Choose one in Settings → Connectors → Jira.',
    });
    expect(jiraStatus('WEB-418')).toBe('To Do');

    await saveMoves({ in_progress: 'Building' });
    const moved = await send('post', '/api/tickets/jira/WEB-418/transition', {
      status: 'in_progress',
    }).expect(200);
    expect(moved.body).toEqual({ outcome: 'succeeded', message: null });
    expect(jiraStatus('WEB-418')).toBe('Building');
  });
});

describe('the status choices in settings', () => {
  const options = async () =>
    ticketMoveOptionsSchema.parse(
      (await get('/api/tickets/connections/jira/move-options').expect(200)).body,
    );

  it('lists each project’s real statuses and what Automatic uses', async () => {
    finishedStatuses('Done', 'Rejected');
    const { projects } = await options();

    expect(projects.map((entry) => entry.project)).toEqual(['API', 'WEB']);
    expect(projects[1]!.moves).toEqual({
      in_progress: { choices: ['In Progress', 'Code Review'], to: 'In Progress', problem: null },
      in_review: { choices: ['In Progress', 'Code Review'], to: 'Code Review', problem: null },
      done: { choices: ['Done', 'Rejected'], to: 'Done', problem: null },
    });
    expect(projects[0]!.moves.in_review).toEqual({
      choices: ['Waiting for QA'],
      to: null,
      problem: 'No review status. Choose one.',
    });
  });

  it('warns when Automatic cannot choose, until a status is chosen', async () => {
    finishedStatuses('Shipped', 'Released');
    expect((await options()).projects[1]!.moves.done).toEqual({
      choices: ['Shipped', 'Released'],
      to: null,
      problem: 'Several finished statuses: Shipped, Released. Choose one.',
    });

    await saveMoves({ done: 'Shipped' });
    const chosen = await options();
    expect(chosen.projects[1]!.moves.done).toMatchObject({ to: 'Shipped', problem: null });
    expect(chosen.projects[0]!.moves.done).toMatchObject({ to: 'Done', problem: null });

    await saveMoves({});
    expect((await options()).projects[1]!.moves.done.to).toBeNull();
  });

  it('refuses a blank status name and an unknown move', async () => {
    await send('patch', '/api/tickets/connections/jira', { moveStatuses: { done: ' ' } }).expect(
      400,
    );
    await send('patch', '/api/tickets/connections/jira', {
      moveStatuses: { todo: 'Backlog' },
    }).expect(400);
  });
});

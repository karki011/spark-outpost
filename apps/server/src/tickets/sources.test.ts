import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JIRA_EMAIL, JIRA_TOKEN } from '../../test/fake-jira.ts';
import { LINEAR_KEY } from '../../test/fake-linear.ts';
import { startTicketStubs, type TicketStubs } from '../../test/ticket-support.ts';
import { jiraSource } from './jira.ts';
import { linearSource } from './linear.ts';
import { TicketApiError } from './source.ts';

let stubs: TicketStubs;

beforeAll(async () => {
  stubs = await startTicketStubs();
});

afterAll(async () => {
  await stubs.close();
});

const linear = (key = LINEAR_KEY, map = {}) => linearSource(key, map, fetch, stubs.linearUrl);
const jira = (token = JIRA_TOKEN, map = {}) =>
  jiraSource({ siteUrl: stubs.jiraUrl, email: JIRA_EMAIL, apiToken: token }, map, fetch);

describe('Linear source', () => {
  it('says who you are and rejects a bad key', async () => {
    expect(await linear().whoami()).toEqual({ id: 'user-1', name: 'alex@example.test' });
    const error = await linear('lin_api_wrong_0123456789abcdefghij')
      .whoami()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TicketApiError);
    expect((error as TicketApiError).status).toBe(401);
    expect((error as Error).message).not.toContain('lin_api');
  });

  it('lists open assigned tickets with filters', async () => {
    const open = await linear().listAssigned({});
    expect(open.map((ticket) => [ticket.key, ticket.status, ticket.project])).toEqual([
      ['ENG-12', 'todo', 'ENG'],
      ['ENG-13', 'in_progress', 'ENG'],
      ['OPS-4', 'todo', 'OPS'],
    ]);
    expect(open[0]).toMatchObject({
      sprint: 'Cycle 7',
      priority: 'High',
      statusName: 'Todo',
      reporter: { name: 'Jordan Lee' },
      createdAt: '2026-09-18T09:00:00.000Z',
    });
    expect(open[1]).toMatchObject({ reporter: null, createdAt: '2026-09-18T09:00:00.000Z' });
    expect((await linear().listAssigned({ status: 'done' })).map((t) => t.key)).toEqual(['ENG-14']);
    expect((await linear().listAssigned({ project: 'ops' })).map((t) => t.key)).toEqual(['OPS-4']);
    expect((await linear().listAssigned({ q: 'today' })).map((t) => t.key)).toEqual(['ENG-12']);
    expect((await linear().listAssigned({ status: 'in_progress' })).map((t) => t.key)).toEqual([
      'ENG-13',
    ]);
  });

  it('reads a ticket with comments, subtasks and links', async () => {
    const ticket = await linear().getTicket('ENG-12');
    expect(ticket).toMatchObject({
      key: 'ENG-12',
      assignee: 'Alex Example',
      labels: ['bug'],
      comments: [{ author: 'Sam', body: 'Seen on Safari too.' }],
      subtasks: [{ key: 'ENG-13', status: 'in_progress', statusName: 'In Progress' }],
      links: [],
    });
    expect(ticket.description).toContain('## Acceptance criteria');
    await expect(linear().getTicket('ENG-999')).rejects.toMatchObject({ status: 404 });
  });

  it('moves through the workflow, links a PR once and comments', async () => {
    const source = linear();
    expect(await source.transition('ENG-12', 'in_progress')).toEqual({
      moved: true,
      statusName: 'In Progress',
      message: null,
    });
    expect(await source.transition('ENG-12', 'in_review')).toMatchObject({
      moved: true,
      statusName: 'In Review',
    });
    expect(await source.transition('ENG-12', 'in_progress')).toMatchObject({ moved: false });
    await source.linkPullRequest('ENG-12', {
      url: 'https://github.com/acme/widgets/pull/1',
      title: 'acme/widgets#1',
    });
    await source.linkPullRequest('ENG-12', {
      url: 'https://github.com/acme/widgets/pull/1',
      title: 'acme/widgets#1',
    });
    await source.comment('ENG-12', 'Draft PR is up.');
    const issue = stubs.linear.issues.find((item) => item.identifier === 'ENG-12')!;
    expect(issue.attachments).toEqual([
      { title: 'acme/widgets#1', url: 'https://github.com/acme/widgets/pull/1' },
    ]);
    expect(issue.comments.at(-1)?.body).toBe('Draft PR is up.');
  });

  it('skips a move when the team has no matching state, unless a map names one', async () => {
    const result = await linear().transition('OPS-4', 'in_review');
    expect(result).toMatchObject({ moved: false, statusName: 'Todo' });
    expect(result.message).toContain('No status maps to In review in OPS');
    const mapped = linear(LINEAR_KEY, { OPS: { in_review: 'Doing' } });
    expect(await mapped.transition('OPS-4', 'in_review')).toMatchObject({
      moved: true,
      statusName: 'Doing',
    });
  });
});

describe('Jira source', () => {
  it('says who you are and rejects a bad token', async () => {
    expect(await jira().whoami()).toEqual({ id: 'acc-1', name: JIRA_EMAIL });
    await expect(jira('jira_wrong_token_000000').whoami()).rejects.toMatchObject({ status: 401 });
  });

  it('lists assigned tickets through JQL', async () => {
    const open = await jira().listAssigned({});
    expect(open.map((ticket) => [ticket.key, ticket.status])).toEqual([
      ['WEB-418', 'todo'],
      ['WEB-419', 'in_progress'],
      ['API-77', 'todo'],
    ]);
    expect(open[0]).toMatchObject({
      url: `${stubs.jiraUrl}/browse/WEB-418`,
      sprint: 'Sprint 41',
      project: 'WEB',
      updatedAt: '2026-09-27T12:00:00.000Z',
      reporter: { name: 'Jordan Lee' },
      createdAt: '2026-09-18T09:00:00.000Z',
    });
    expect(open[1]).toMatchObject({ reporter: null, createdAt: null });
    expect((await jira().listAssigned({ project: 'API' })).map((t) => t.key)).toEqual(['API-77']);
    expect((await jira().listAssigned({ status: 'done' })).map((t) => t.key)).toEqual(['WEB-420']);
    expect((await jira().listAssigned({ q: 'csv' })).map((t) => t.key)).toEqual([
      'WEB-418',
      'WEB-419',
    ]);
    expect(stubs.jira.jql.at(-1)).toBe(
      'assignee = currentUser() AND statusCategory != Done AND text ~ "csv" ORDER BY updated DESC',
    );
  });

  it('reads a ticket and converts its description', async () => {
    const ticket = await jira().getTicket('WEB-418');
    expect(ticket.description).toBe(
      'People want the usage table in a spreadsheet.\n\n### Acceptance criteria\n\n- A Download CSV button\n- Columns match the table',
    );
    expect(ticket).toMatchObject({
      comments: [
        { author: 'Sam', body: 'Include cost too.', createdAt: '2026-09-26T08:00:00.000Z' },
      ],
      subtasks: [{ key: 'WEB-419', status: 'in_progress' }],
      labels: ['frontend'],
    });
    await expect(jira().getTicket('WEB-999')).rejects.toMatchObject({ status: 404 });
  });

  it('transitions, links a PR idempotently and comments', async () => {
    const source = jira();
    expect(await source.transition('WEB-418', 'in_progress')).toMatchObject({
      moved: true,
      statusName: 'In Progress',
    });
    expect(await source.transition('WEB-418', 'in_review')).toMatchObject({
      moved: true,
      statusName: 'Code Review',
    });
    const pull = { url: 'https://github.com/acme/widgets/pull/2', title: 'acme/widgets#2' };
    await source.linkPullRequest('WEB-418', pull);
    await source.linkPullRequest('WEB-418', pull);
    await source.comment('WEB-418', 'Draft PR is up.');
    const issue = stubs.jira.issues.find((item) => item.key === 'WEB-418')!;
    expect(issue.remoteLinks).toHaveLength(1);
    expect((await source.getTicket('WEB-418')).links).toEqual([pull]);
    expect(issue.comments.at(-1)?.body).toMatchObject({ type: 'doc' });
    const qa = await source.transition('API-77', 'in_review');
    expect(qa.moved).toBe(false);
    const mapped = jira(JIRA_TOKEN, { API: { in_review: 'Waiting for QA' } });
    expect(await mapped.transition('API-77', 'in_review')).toMatchObject({ moved: true });
  });

  it('explains an unreachable site without a stack of details', async () => {
    const offline = jiraSource(
      { siteUrl: 'http://127.0.0.1:9', email: JIRA_EMAIL, apiToken: JIRA_TOKEN },
      {},
      fetch,
    );
    await expect(offline.whoami()).rejects.toThrow("Couldn't reach Jira");
  });
});

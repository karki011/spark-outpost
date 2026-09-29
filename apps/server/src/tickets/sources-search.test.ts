import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JIRA_EMAIL, JIRA_TOKEN } from '../../test/fake-jira.ts';
import { LINEAR_KEY } from '../../test/fake-linear.ts';
import { startTicketStubs, type TicketStubs } from '../../test/ticket-support.ts';
import { jiraSource } from './jira.ts';
import { linearSource } from './linear.ts';

let stubs: TicketStubs;

beforeAll(async () => {
  stubs = await startTicketStubs();
});

afterAll(async () => {
  await stubs.close();
});

const linear = () => linearSource(LINEAR_KEY, {}, fetch, stubs.linearUrl);
const jira = () =>
  jiraSource({ siteUrl: stubs.jiraUrl, email: JIRA_EMAIL, apiToken: JIRA_TOKEN }, {}, fetch);

describe('Linear search and assign', () => {
  it('searches every visible ticket and reports its assignee', async () => {
    const found = await linear().search({ q: '', assignee: 'anyone' });
    expect(found.map((ticket) => [ticket.key, ticket.assignedTo?.name ?? null])).toEqual([
      ['ENG-12', 'Alex Example'],
      ['ENG-13', 'Alex Example'],
      ['ENG-15', 'Jordan Lee'],
      ['ENG-16', null],
      ['OPS-4', 'Alex Example'],
    ]);
    expect((await linear().search({ q: 'upload', assignee: 'anyone' })).map((t) => t.key)).toEqual([
      'ENG-16',
    ]);
    expect((await linear().search({ q: 'eng-15', assignee: 'anyone' })).map((t) => t.key)).toEqual([
      'ENG-15',
    ]);
    expect((await linear().search({ q: '', assignee: 'unassigned' })).map((t) => t.key)).toEqual([
      'ENG-16',
    ]);
    expect((await linear().search({ q: '', assignee: 'others' })).map((t) => t.key)).toEqual([
      'ENG-15',
    ]);
  });

  it('reads the extra summary fields and assigns or clears the assignee', async () => {
    const summary = await linear().getSummary('ENG-12');
    expect(summary).toMatchObject({
      priorityRank: 2,
      priority: 'High',
      labels: ['bug'],
      assignedTo: { id: 'user-1', name: 'Alex Example' },
    });
    await linear().assign('ENG-16', 'user-1');
    expect((await linear().getSummary('ENG-16')).assignedTo?.id).toBe('user-1');
    await linear().assign('ENG-16', null);
    expect((await linear().getSummary('ENG-16')).assignedTo).toBeNull();
  });

  it('lists tickets done recently', async () => {
    const done = await linear().listAssigned({ status: 'done', doneWithinDays: 7 });
    expect(done.map((ticket) => [ticket.key, ticket.doneAt])).toEqual([
      ['ENG-14', '2026-09-27T08:00:00.000Z'],
    ]);
  });
});

describe('Jira search and assign', () => {
  it('searches everyone by default and filters by assignee', async () => {
    const found = await jira().search({ q: 'upload', assignee: 'anyone' });
    expect(found.map((ticket) => [ticket.key, ticket.assignedTo?.id ?? null])).toEqual([
      ['WEB-437', 'acc-2'],
      ['API-95', null],
    ]);
    expect((await jira().search({ q: '', assignee: 'unassigned' })).map((t) => t.key)).toEqual([
      'API-95',
    ]);
  });

  it('assigns through the assignee endpoint and explains a refusal', async () => {
    await jira().assign('API-95', 'acc-1');
    expect((await jira().getSummary('API-95')).assignedTo).toEqual({
      id: 'acc-1',
      name: 'Alex Example',
    });
    stubs.jira.denyAssign.add('WEB');
    await expect(jira().assign('WEB-437', 'acc-1')).rejects.toMatchObject({ status: 403 });
  });
});

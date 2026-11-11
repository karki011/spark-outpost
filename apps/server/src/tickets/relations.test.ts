import { describe, expect, it } from 'vitest';
import { jiraSource } from './jira.ts';
import { linearSource } from './linear.ts';

const SITE = 'https://acme.atlassian.net';
const moves = { statusMap: {}, moveStatuses: {} };

const jiraStatus = (name: string, category: string) => ({
  name,
  statusCategory: { key: category },
});
const jiraRef = (key: string, summary: string, name = 'To Do', category = 'new') => ({
  key,
  fields: { summary, status: jiraStatus(name, category) },
});

function jiraIssue(extra: Record<string, unknown>) {
  return {
    id: '1001',
    key: 'WEB-1',
    fields: {
      summary: 'Export CSV',
      status: jiraStatus('In Progress', 'indeterminate'),
      updated: '2026-09-27T12:00:00.000+0000',
      project: { key: 'WEB' },
      description: null,
      assignee: null,
      labels: [],
      comment: { comments: [] },
      ...extra,
    },
  };
}

function jiraDetail(extra: Record<string, unknown>) {
  const fetchImpl = (async (url: string) => {
    const body = url.includes('/remotelink') ? [] : jiraIssue(extra);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return jiraSource({ siteUrl: SITE, email: 'a@b.test', apiToken: 'token' }, moves, fetchImpl);
}

const linearRef = (identifier: string, title: string, name = 'Todo', type = 'unstarted') => ({
  identifier,
  title,
  url: `https://linear.app/acme/issue/${identifier}`,
  state: { name, type },
});

function linearIssue(extra: Record<string, unknown>) {
  return {
    id: 'lin-1',
    identifier: 'ENG-1',
    title: 'Fix the chart',
    url: 'https://linear.app/acme/issue/ENG-1',
    updatedAt: '2026-09-27T12:00:00.000Z',
    state: { name: 'Todo', type: 'unstarted' },
    team: { key: 'ENG' },
    description: '',
    comments: { nodes: [] },
    attachments: { nodes: [] },
    ...extra,
  };
}

function linearDetail(extra: Record<string, unknown>) {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ data: { issue: linearIssue(extra) } }), {
      status: 200,
    })) as unknown as typeof fetch;
  return linearSource('lin_api_key', moves, fetchImpl, 'https://linear.test/graphql');
}

describe('Jira ticket relations', () => {
  it('reads the parent, links in both directions and subtasks from the one detail request', async () => {
    const requested: string[] = [];
    const fetchImpl = (async (url: string) => {
      requested.push(url);
      const body = url.includes('/remotelink')
        ? []
        : jiraIssue({
            parent: jiraRef('WEB-100', 'CSV epic', 'In Progress', 'indeterminate'),
            issuelinks: [
              {
                type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
                outwardIssue: jiraRef('WEB-7', 'Ship the report'),
              },
              {
                type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
                inwardIssue: jiraRef('API-9', 'Add the endpoint', 'Done', 'done'),
              },
            ],
            subtasks: [jiraRef('WEB-2', 'Header row')],
          });
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const source = jiraSource(
      { siteUrl: SITE, email: 'a@b.test', apiToken: 'token' },
      moves,
      fetchImpl,
    );

    const ticket = await source.getTicket('WEB-1');

    expect(requested).toHaveLength(2);
    expect(requested[0]).toMatch(/fields=[^&]*parent[^&]*issuelinks[^&]*subtasks/);
    expect(ticket.parent).toEqual({
      key: 'WEB-100',
      title: 'CSV epic',
      status: 'in_progress',
      statusName: 'In Progress',
      url: `${SITE}/browse/WEB-100`,
    });
    expect(ticket.relations).toEqual([
      expect.objectContaining({ relation: 'blocks', key: 'WEB-7', status: 'todo' }),
      expect.objectContaining({
        relation: 'is blocked by',
        key: 'API-9',
        title: 'Add the endpoint',
        status: 'done',
        url: `${SITE}/browse/API-9`,
      }),
    ]);
    expect(ticket.subtasks).toEqual([
      expect.objectContaining({ key: 'WEB-2', url: `${SITE}/browse/WEB-2` }),
    ]);
    expect(ticket.subtasksMore).toBe(false);
  });

  it('caps subtasks at 50 and says there are more', async () => {
    const subtasks = Array.from({ length: 60 }, (_, index) => jiraRef(`WEB-${index + 10}`, 'Sub'));
    const ticket = await jiraDetail({ subtasks }).getTicket('WEB-1');
    expect(ticket.subtasks).toHaveLength(50);
    expect(ticket.subtasksMore).toBe(true);
  });

  it('gives empty lists for missing or odd fields instead of failing the ticket', async () => {
    const missing = await jiraDetail({}).getTicket('WEB-1');
    expect(missing).toMatchObject({ parent: null, relations: [], subtasks: [] });

    const odd = await jiraDetail({
      parent: 'WEB-100',
      issuelinks: [
        'nope',
        { type: { inward: 'x' } },
        { type: { name: 'Relates', inward: 'relates to', outward: 'relates to' } },
        {
          type: { name: 'Relates', inward: 'relates to', outward: 'relates to' },
          outwardIssue: { key: 'WEB-8', fields: { summary: 5 } },
        },
      ],
      subtasks: 'many',
    }).getTicket('WEB-1');
    expect(odd).toMatchObject({ parent: null, relations: [], subtasks: [], subtasksMore: false });

    const oneBad = await jiraDetail({
      issuelinks: [
        {
          type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
          outwardIssue: jiraRef('WEB-7', 'Ship the report'),
        },
        { type: null },
      ],
      subtasks: [jiraRef('WEB-2', 'Header row'), { key: 'WEB-3' }],
    }).getTicket('WEB-1');
    expect(oneBad.relations?.map((link) => link.key)).toEqual(['WEB-7']);
    expect(oneBad.subtasks.map((sub) => sub.key)).toEqual(['WEB-2']);
  });
});

describe('Linear ticket relations', () => {
  it('reads the parent, relations both ways and children', async () => {
    const ticket = await linearDetail({
      parent: linearRef('ENG-100', 'Charts project', 'In Progress', 'started'),
      children: {
        pageInfo: { hasNextPage: false },
        nodes: [linearRef('ENG-2', 'Axis labels')],
      },
      relations: {
        nodes: [
          { type: 'blocks', relatedIssue: linearRef('ENG-7', 'Ship the report') },
          { type: 'duplicate', relatedIssue: linearRef('ENG-8', 'Same bug') },
          { type: 'related', relatedIssue: linearRef('ENG-5', 'Colours') },
        ],
      },
      inverseRelations: {
        nodes: [
          { type: 'blocks', issue: linearRef('ENG-9', 'Data model', 'Done', 'completed') },
          { type: 'duplicate', issue: linearRef('ENG-10', 'Copy') },
        ],
      },
    }).getTicket('ENG-1');

    expect(ticket.parent).toEqual({
      key: 'ENG-100',
      title: 'Charts project',
      status: 'in_progress',
      statusName: 'In Progress',
      url: 'https://linear.app/acme/issue/ENG-100',
    });
    expect(ticket.relations?.map((link) => [link.relation, link.key, link.status])).toEqual([
      ['blocks', 'ENG-7', 'todo'],
      ['duplicates', 'ENG-8', 'todo'],
      ['relates to', 'ENG-5', 'todo'],
      ['is blocked by', 'ENG-9', 'done'],
      ['is duplicated by', 'ENG-10', 'todo'],
    ]);
    expect(ticket.subtasks).toEqual([
      expect.objectContaining({ key: 'ENG-2', url: 'https://linear.app/acme/issue/ENG-2' }),
    ]);
    expect(ticket.subtasksMore).toBe(false);
  });

  it('flags more children when Linear says there is another page', async () => {
    const ticket = await linearDetail({
      children: { pageInfo: { hasNextPage: true }, nodes: [linearRef('ENG-2', 'Axis labels')] },
    }).getTicket('ENG-1');
    expect(ticket.subtasks).toHaveLength(1);
    expect(ticket.subtasksMore).toBe(true);
  });

  it('gives empty lists for missing or odd fields instead of failing the ticket', async () => {
    const missing = await linearDetail({}).getTicket('ENG-1');
    expect(missing).toMatchObject({ parent: null, relations: [], subtasks: [] });

    const odd = await linearDetail({
      parent: { identifier: 'ENG-100' },
      children: 'none',
      relations: { nodes: [{ type: 'blocks', relatedIssue: null }, 'x'] },
      inverseRelations: 7,
    }).getTicket('ENG-1');
    expect(odd).toMatchObject({ parent: null, relations: [], subtasks: [], subtasksMore: false });
  });
});

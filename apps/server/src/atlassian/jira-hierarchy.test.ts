import { describe, expect, it } from 'vitest';
import { atlassianClient } from './access.ts';
import {
  parentOf,
  placementFields,
  projectIssueTypes,
  readTeamField,
  resolveTeam,
  teamJql,
  teamOf,
} from './jira-hierarchy.ts';

const TEAM = '36885b3c-1bf0-4f85-a357-c5b858c31de4';
const RM_TEAM = 'com.atlassian.teams:rm-teams-custom-field-team';

type Routes = Record<string, (body: unknown) => [number, unknown]>;

function clientWith(routes: Routes) {
  const asked: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    asked.push(`${key}${url.search}`);
    const route = routes[key];
    const [status, data] = route
      ? route(init?.body ? JSON.parse(String(init.body)) : null)
      : [404, { errorMessages: ['Not found'] }];
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const access = { siteUrl: 'https://example.atlassian.net', email: 'a@b.test', apiToken: 't' };
  return { client: atlassianClient(access, fetchImpl, { name: 'Jira', thing: 'ticket' }), asked };
}

const fieldList = (...customs: string[]): Routes => ({
  'GET /rest/api/3/field': () => [
    200,
    [
      { id: 'summary', name: 'Summary' },
      ...customs.map((custom, index) => ({
        id: `customfield_1000${index + 1}`,
        name: index === 0 ? 'Team' : 'Old team',
        schema: { custom },
      })),
    ],
  ],
});

describe('Jira placement fields', () => {
  it('writes parent by key, the type by name and the team as its id string', () => {
    expect(
      placementFields({
        parent: 'WEB-1',
        issueType: 'Sub-task',
        team: { field: 'customfield_10001', id: TEAM, name: 'Platform' },
      }),
    ).toEqual({
      parent: { key: 'WEB-1' },
      issuetype: { name: 'Sub-task' },
      customfield_10001: TEAM,
    });
    expect(placementFields({ parent: null, team: null })).toEqual({});
  });

  it('reads parent and team leniently', () => {
    expect(parentOf({ key: 'WEB-1', fields: { summary: 'Epic' } })).toEqual({
      key: 'WEB-1',
      summary: 'Epic',
    });
    expect(parentOf({ id: '1' })).toBeNull();
    expect(parentOf('WEB-1')).toBeNull();
    expect(teamOf({ id: TEAM, title: 'Platform' })).toEqual({ id: TEAM, name: 'Platform' });
    expect(teamOf(TEAM)).toEqual({ id: TEAM, name: null });
    expect(teamOf([{ id: TEAM }])).toBeNull();
    expect(teamOf(null)).toBeNull();
  });

  it('finds teams on a project by the custom field number', () => {
    expect(teamJql('WEB', 'customfield_10001')).toBe(
      'project = "WEB" AND cf[10001] is not EMPTY ORDER BY updated DESC',
    );
    expect(teamJql('A"B', 'customfield_7')).toContain('project = "A\\"B"');
  });
});

describe('the Team field', () => {
  it('is found by its field type, not its name, and is null when absent or unreadable', async () => {
    expect(await readTeamField(clientWith(fieldList(RM_TEAM)).client)).toBe('customfield_10001');
    expect(await readTeamField(clientWith(fieldList('other:type')).client)).toBeNull();
    expect(await readTeamField(clientWith({}).client)).toBeNull();
    const offline = clientWith({
      'GET /rest/api/3/field': () => {
        throw new TypeError('fetch failed');
      },
    });
    expect(await readTeamField(offline.client)).toBeNull();
  });

  it('resolves a name from the teams seen on the project, case-insensitively', async () => {
    const { client, asked } = clientWith({
      ...fieldList(RM_TEAM),
      'POST /rest/api/3/search/jql': () => [
        200,
        {
          issues: [
            { key: 'WEB-1', fields: { customfield_10001: { id: TEAM, name: 'Platform' } } },
            { key: 'WEB-2', fields: { customfield_10001: 'odd' } },
            { key: 'WEB-3', fields: {} },
          ],
        },
      ],
    });
    expect(await resolveTeam(client, 'WEB', 'platform')).toEqual({
      field: 'customfield_10001',
      id: TEAM,
      name: 'Platform',
    });
    expect(asked).toContain('POST /rest/api/3/search/jql');
  });

  it('takes a team id it has not seen, and refuses an unknown name naming the teams seen', async () => {
    const { client } = clientWith({
      ...fieldList(RM_TEAM),
      'POST /rest/api/3/search/jql': () => [200, { issues: [] }],
    });
    expect(await resolveTeam(client, 'WEB', TEAM)).toEqual({
      field: 'customfield_10001',
      id: TEAM,
      name: null,
    });
    await expect(resolveTeam(client, 'WEB', 'Nobody')).rejects.toThrow(/No single team named/);
  });

  it('refuses when the site has no Team field or several', async () => {
    await expect(resolveTeam(clientWith(fieldList()).client, 'WEB', TEAM)).rejects.toThrow(
      /no Team field/,
    );
    const several = clientWith(
      fieldList(RM_TEAM, 'com.atlassian.jira.plugin.system.customfieldtypes:atlassian-team'),
    );
    await expect(resolveTeam(several.client, 'WEB', TEAM)).rejects.toThrow(
      /Team \(customfield_10001\), Old team \(customfield_10002\)/,
    );
  });
});

describe('project issue types', () => {
  it('lists types with the sub-task flag from create metadata', async () => {
    const { client, asked } = clientWith({
      'GET /rest/api/3/issue/createmeta/WEB/issuetypes': () => [
        200,
        {
          issueTypes: [
            { id: '1', name: 'Story', subtask: false },
            { id: '2', name: 'Subtask', subtask: true },
          ],
        },
      ],
    });
    expect(await projectIssueTypes(client, 'WEB')).toEqual([
      { id: '1', name: 'Story', subtask: false },
      { id: '2', name: 'Subtask', subtask: true },
    ]);
    expect(asked).toEqual(['GET /rest/api/3/issue/createmeta/WEB/issuetypes?maxResults=100']);
  });

  it('says plainly when the account cannot see the project', async () => {
    const { client } = clientWith({
      'GET /rest/api/3/issue/createmeta/WEB/issuetypes': () => [
        403,
        { errorMessages: ['You do not have permission to create issues in this project.'] },
      ],
    });
    await expect(projectIssueTypes(client, 'WEB')).rejects.toThrow(
      'Jira said: You do not have permission to create issues in this project.',
    );
  });
});

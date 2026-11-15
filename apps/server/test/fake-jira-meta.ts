import type { FakeJiraIssue } from './fake-jira.ts';
import { editMeta } from './fake-jira-work.ts';

export const TEAM_FIELD = 'customfield_10001';
export const TEAM_PLATFORM = '36885b3c-1bf0-4f85-a357-c5b858c31de4';
export const TEAM_PAYMENTS = '9b1f2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

export const fakeTeams: Record<string, string> = {
  [TEAM_PLATFORM]: 'Platform',
  [TEAM_PAYMENTS]: 'Payments',
};

const ISSUE_TYPES = [
  { id: '10001', name: 'Epic', subtask: false },
  { id: '10002', name: 'Story', subtask: false },
  { id: '10003', name: 'Task', subtask: false },
  { id: '10004', name: 'Bug', subtask: false },
  { id: '10005', name: 'Sub-task', subtask: true },
];

const FIELDS = [
  { id: 'summary', name: 'Summary', custom: false, schema: { type: 'string' } },
  {
    id: 'customfield_10020',
    name: 'Sprint',
    custom: true,
    schema: { type: 'array', custom: 'com.pyxis.greenhopper.jira:gh-sprint' },
  },
  {
    id: TEAM_FIELD,
    name: 'Team',
    custom: true,
    schema: { type: 'team', custom: 'com.atlassian.teams:rm-teams-custom-field-team' },
  },
];

const CREATE_META = /^\/rest\/api\/3\/issue\/createmeta\/([^/]+)\/issuetypes(?:\/(\d+))?$/;

export const isSubtaskType = (name: string | undefined) =>
  ISSUE_TYPES.some((type) => type.name === name && type.subtask);

export function metaAnswer(pathname: string, projects: string[]): [number, unknown] | null {
  if (pathname === '/rest/api/3/field') return [200, FIELDS];
  const meta = CREATE_META.exec(pathname);
  if (!meta) return null;
  if (!projects.includes(decodeURIComponent(meta[1]!))) {
    return [404, { errorMessages: ['No project could be found.'] }];
  }
  if (meta[2]) {
    const fields = Object.entries(editMeta(meta[1]!).fields).map(([fieldId, field]) => ({
      fieldId,
      key: fieldId,
      ...field,
    }));
    return [200, { fields, maxResults: 200, startAt: 0, total: fields.length }];
  }
  return [200, { issueTypes: ISSUE_TYPES, maxResults: 100, startAt: 0, total: ISSUE_TYPES.length }];
}

export function hierarchyView(item: FakeJiraIssue, issues: FakeJiraIssue[]) {
  const parent = item.parent ? issues.find((entry) => entry.key === item.parent) : undefined;
  return {
    issuetype: { name: item.type ?? 'Task', subtask: isSubtaskType(item.type) },
    parent: parent ? { key: parent.key, fields: { summary: parent.summary } } : null,
    [TEAM_FIELD]: item.team
      ? { id: item.team, name: fakeTeams[item.team], title: fakeTeams[item.team] }
      : null,
  };
}

interface Placement {
  parent?: { key?: string };
  issuetype?: { name?: string };
  [TEAM_FIELD]?: unknown;
}

export function placementErrors(
  fields: Placement,
  issues: FakeJiraIssue[],
  type: string | undefined,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const parentKey = fields.parent?.key;
  if (parentKey && !issues.some((entry) => entry.key === parentKey)) {
    errors.parent = `Could not find issue by id or key: ${parentKey}`;
  }
  if (isSubtaskType(type) && !parentKey) {
    errors.parent = 'Issue type is a sub-task but parent issue key or id not specified.';
  }
  const team = fields[TEAM_FIELD];
  if (team !== undefined && (typeof team !== 'string' || !fakeTeams[team])) {
    errors[TEAM_FIELD] = 'The Team must be a string';
  }
  return errors;
}

export function applyPlacement(item: FakeJiraIssue, fields: Placement, issues: FakeJiraIssue[]) {
  if (fields.issuetype?.name) item.type = fields.issuetype.name;
  const team = fields[TEAM_FIELD];
  if (typeof team === 'string') item.team = team;
  const parentKey = fields.parent?.key;
  if (!parentKey) return;
  item.parent = parentKey;
  const parent = issues.find((entry) => entry.key === parentKey);
  if (parent && isSubtaskType(item.type) && !parent.subtasks.includes(item.key)) {
    parent.subtasks.push(item.key);
  }
}

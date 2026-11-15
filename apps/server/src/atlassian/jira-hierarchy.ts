import { z } from 'zod';
import { isOk } from '../tickets/http.ts';
import { TicketApiError } from '../tickets/source.ts';
import type { AtlassianClient } from './access.ts';

const TEAM_TYPES = new Set([
  'com.atlassian.teams:rm-teams-custom-field-team',
  'com.atlassian.jira.plugin.system.customfieldtypes:atlassian-team',
]);
const TEAM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEEN_ISSUES = 100;

const fieldListSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    schema: z.object({ custom: z.string().optional() }).optional(),
  }),
);

export interface JiraTeam {
  id: string;
  name: string | null;
}

export interface JiraTeamChoice extends JiraTeam {
  field: string;
}

export interface JiraPlacement {
  parent?: string | null | undefined;
  issueType?: string | null | undefined;
  team?: JiraTeamChoice | null | undefined;
}

export interface JiraIssueType {
  name: string;
  subtask: boolean;
}

export interface JiraParent {
  key: string;
  summary: string | null;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export function placementFields(placement: JiraPlacement): Record<string, unknown> {
  return {
    ...(placement.parent ? { parent: { key: placement.parent } } : {}),
    ...(placement.issueType ? { issuetype: { name: placement.issueType } } : {}),
    ...(placement.team ? { [placement.team.field]: placement.team.id } : {}),
  };
}

export function teamOf(value: unknown): JiraTeam | null {
  if (typeof value === 'string' && value) return { id: value, name: null };
  const team = record(value);
  const id = text(team?.id);
  if (!team || !id) return null;
  return { id, name: text(team.name) ?? text(team.title) };
}

export function parentOf(value: unknown): JiraParent | null {
  const parent = record(value);
  const key = text(parent?.key);
  if (!parent || !key) return null;
  return { key, summary: text(record(parent.fields)?.summary) };
}

export function issueTypeOf(value: unknown): string | null {
  return text(record(value)?.name);
}

export async function teamFields(client: AtlassianClient): Promise<{ id: string; name: string }[]> {
  const answer = await client.raw({ method: 'GET', path: '/rest/api/3/field' });
  if (!isOk(answer)) return [];
  const parsed = fieldListSchema.safeParse(answer.data);
  if (!parsed.success) return [];
  return parsed.data
    .filter((field) => TEAM_TYPES.has(field.schema?.custom ?? ''))
    .map(({ id, name }) => ({ id, name }));
}

export async function readTeamField(client: AtlassianClient): Promise<string | null> {
  const fields = await teamFields(client).catch(() => []);
  return fields.length === 1 ? fields[0]!.id : null;
}

async function requireTeamField(client: AtlassianClient): Promise<string> {
  const fields = await teamFields(client);
  if (fields.length === 1) return fields[0]!.id;
  if (fields.length === 0) {
    throw new TicketApiError(
      400,
      'This Jira site has no Team field Spark can see. Nothing was changed. Turn on Teams in Jira for the site and project, then try again.',
    );
  }
  const names = fields.map((field) => `${field.name} (${field.id})`).join(', ');
  throw new TicketApiError(
    400,
    `This Jira site has several Team fields: ${names}. Nothing was changed.`,
  );
}

const quoted = (value: string) => `"${value.replace(/["\\]/g, '\\$&')}"`;

export function teamJql(project: string, field: string): string {
  return `project = ${quoted(project)} AND cf[${field.replace('customfield_', '')}] is not EMPTY ORDER BY updated DESC`;
}

export async function teamsSeen(
  client: AtlassianClient,
  project: string,
  field: string,
): Promise<JiraTeam[]> {
  const answer = await client.raw({
    method: 'POST',
    path: '/rest/api/3/search/jql',
    body: { jql: teamJql(project, field), fields: [field], maxResults: SEEN_ISSUES },
  });
  if (!isOk(answer)) return [];
  const issues = record(answer.data)?.issues;
  const seen = new Map<string, JiraTeam>();
  for (const issue of Array.isArray(issues) ? issues : []) {
    const team = teamOf(record(record(issue)?.fields)?.[field]);
    if (team && !seen.has(team.id)) seen.set(team.id, team);
  }
  return [...seen.values()];
}

export async function resolveTeam(
  client: AtlassianClient,
  project: string,
  wanted: string,
): Promise<JiraTeamChoice> {
  const field = await requireTeamField(client);
  const seen = await teamsSeen(client, project, field);
  const byId = seen.find((team) => team.id === wanted);
  if (byId) return { field, ...byId };
  if (TEAM_ID.test(wanted)) return { field, id: wanted, name: null };
  const byName = seen.filter((team) => team.name?.toLowerCase() === wanted.toLowerCase());
  if (byName.length === 1) return { field, ...byName[0]! };
  const known = seen.map((team) => `${team.name ?? 'unnamed'} (${team.id})`).join(', ');
  throw new TicketApiError(
    400,
    `No single team named "${wanted}" on recent ${project} issues${known ? `; seen: ${known}` : ''}. Nothing was changed. Pass the team id, the last part of the team's profile address after /team/.`,
  );
}

const issueTypesSchema = z.object({
  issueTypes: z.array(z.object({ name: z.string(), subtask: z.boolean().optional() })).optional(),
  values: z.array(z.object({ name: z.string(), subtask: z.boolean().optional() })).optional(),
});

export async function projectIssueTypes(
  client: AtlassianClient,
  project: string,
): Promise<JiraIssueType[]> {
  const found = await client.call(
    issueTypesSchema,
    {
      method: 'GET',
      path: `/rest/api/3/issue/createmeta/${encodeURIComponent(project)}/issuetypes?maxResults=100`,
    },
    `reading the issue types of ${project}`,
  );
  return (found.issueTypes ?? found.values ?? []).map((type) => ({
    name: type.name,
    subtask: type.subtask ?? false,
  }));
}

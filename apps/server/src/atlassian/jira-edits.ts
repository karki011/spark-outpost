import { z } from 'zod';
import { adfToText, textToAdf } from '../tickets/jira-adf.ts';
import { atlassianClient, type AtlassianAccess } from './access.ts';
import { jiraAgile } from './jira-agile.ts';
import { jiraProjects } from './jira-projects.ts';
import { jiraTransfer } from './jira-transfer.ts';
import { jiraWork, type JiraVisibility } from './jira-work.ts';
import {
  issueTypeOf,
  parentOf,
  placementFields,
  readTeamField,
  teamOf,
  type JiraParent,
  type JiraTeam,
  type JiraTeamChoice,
} from './jira-hierarchy.ts';

export const JIRA = { name: 'Jira', thing: 'ticket' };

const SEARCH_FIELDS = [
  'summary',
  'status',
  'assignee',
  'priority',
  'updated',
  'project',
  'issuetype',
  'parent',
];
const FACT_FIELDS = [
  'summary',
  'description',
  'labels',
  'priority',
  'updated',
  'status',
  'subtasks',
  'parent',
  'issuetype',
];

const person = z.object({ accountId: z.string().optional(), displayName: z.string() });
const named = z.object({ name: z.string() }).nullable().optional();

const searchSchema = z.object({
  issues: z.array(
    z.object({
      key: z.string(),
      fields: z.looseObject({
        summary: z.string(),
        status: named,
        assignee: person.nullable().optional(),
        priority: named,
        updated: z.string().optional(),
        project: z.object({ key: z.string() }).nullable().optional(),
        issuetype: named,
        parent: z.unknown().optional(),
      }),
    }),
  ),
  nextPageToken: z.string().nullable().optional(),
});

const factsSchema = z.object({
  key: z.string(),
  fields: z.looseObject({
    summary: z.string(),
    description: z.unknown().optional(),
    labels: z.array(z.string()).optional(),
    priority: named,
    updated: z.string(),
    status: named,
    subtasks: z.array(z.object({ key: z.string() })).optional(),
    parent: z.unknown().optional(),
    issuetype: z.unknown().optional(),
  }),
});

const commentSchema = z.object({
  id: z.string(),
  author: person.nullable().optional(),
  body: z.unknown(),
  created: z.string(),
  updated: z.string().optional(),
  visibility: z.object({ type: z.string(), value: z.string() }).optional().catch(undefined),
});
const commentsSchema = z.object({ comments: z.array(commentSchema), total: z.number().optional() });

export interface JiraFacts {
  key: string;
  summary: string;
  description: string;
  labels: string[];
  priority: string | null;
  status: string | null;
  updated: string;
  subtasks: string[];
  parent: JiraParent | null;
  type: string | null;
  team: JiraTeam | null;
}

export interface JiraComment {
  id: string;
  authorId: string | null;
  author: string | null;
  body: string;
  createdAt: string;
  updatedAt: string | null;
  visibility: string | null;
}

export interface JiraFieldChange {
  summary?: string | undefined;
  description?: string | undefined;
  labels?: string[] | undefined;
  priority?: string | undefined;
  parent?: string | undefined;
  issueType?: string | undefined;
  team?: JiraTeamChoice | undefined;
}

const issuePath = (key: string) => `/rest/api/3/issue/${encodeURIComponent(key)}`;
const commentPath = (key: string, id: string) =>
  `${issuePath(key)}/comment/${encodeURIComponent(id)}`;

function commentOf(comment: z.infer<typeof commentSchema>): JiraComment {
  return {
    id: comment.id,
    authorId: comment.author?.accountId ?? null,
    author: comment.author?.displayName ?? null,
    body: adfToText(comment.body),
    createdAt: comment.created,
    updatedAt: comment.updated ?? null,
    visibility: comment.visibility
      ? `${comment.visibility.type} ${comment.visibility.value}`
      : null,
  };
}

export function changeFields(change: JiraFieldChange): Record<string, unknown> {
  return {
    ...(change.summary !== undefined ? { summary: change.summary } : {}),
    ...(change.description !== undefined ? { description: textToAdf(change.description) } : {}),
    ...(change.labels !== undefined ? { labels: change.labels } : {}),
    ...(change.priority !== undefined ? { priority: { name: change.priority } } : {}),
    ...placementFields(change),
  };
}

export function jiraEdits(access: AtlassianAccess, fetchImpl: typeof fetch) {
  const client = atlassianClient(access, fetchImpl, JIRA);
  const browse = (key: string) => `${access.siteUrl}/browse/${key}`;
  let teamField: Promise<string | null> | null = null;
  const teamFieldId = () => (teamField ??= readTeamField(client));
  const withTeam = async (fields: string[]) => {
    const team = await teamFieldId();
    return { team, fields: team ? [...fields, team] : fields };
  };
  return {
    browse,
    client,
    teamFieldId,
    work: jiraWork(client),
    agile: jiraAgile(client),
    projects: jiraProjects(client),
    transfer: jiraTransfer(access, fetchImpl),
    async issueFields(key: string, fields: readonly string[]) {
      const issue = await client.call(
        z.object({ key: z.string(), fields: z.record(z.string(), z.unknown()) }),
        {
          method: 'GET',
          path: `${issuePath(key)}?fields=${fields.map(encodeURIComponent).join(',')}`,
        },
        `reading ${key}`,
      );
      return issue.fields;
    },
    async edit(
      key: string,
      body: { fields?: Record<string, unknown>; update?: Record<string, unknown> },
    ) {
      await client.call(null, { method: 'PUT', path: issuePath(key), body }, `changing ${key}`);
    },
    async createIssue(fields: Record<string, unknown>) {
      const created = await client.call(
        z.object({ key: z.string() }),
        { method: 'POST', path: '/rest/api/3/issue', body: { fields } },
        'creating the ticket',
      );
      return { key: created.key, url: browse(created.key) };
    },
    async search(jql: string, limit: number, pageToken: string | null) {
      const asked = await withTeam(SEARCH_FIELDS);
      const found = await client.call(
        searchSchema,
        {
          method: 'POST',
          path: '/rest/api/3/search/jql',
          body: {
            jql,
            fields: asked.fields,
            maxResults: limit,
            ...(pageToken ? { nextPageToken: pageToken } : {}),
          },
        },
        'searching with JQL',
      );
      return {
        issues: found.issues.map((issue) => ({
          key: issue.key,
          title: issue.fields.summary,
          status: issue.fields.status?.name ?? null,
          type: issue.fields.issuetype?.name ?? null,
          parent: parentOf(issue.fields.parent)?.key ?? null,
          team: asked.team ? teamOf(issue.fields[asked.team]) : null,
          priority: issue.fields.priority?.name ?? null,
          assignee: issue.fields.assignee?.displayName ?? null,
          project: issue.fields.project?.key ?? null,
          updatedAt: issue.fields.updated ?? null,
          url: browse(issue.key),
        })),
        nextPageToken: found.nextPageToken ?? null,
      };
    },
    async facts(key: string): Promise<JiraFacts> {
      const asked = await withTeam(FACT_FIELDS);
      const issue = await client.call(
        factsSchema,
        { method: 'GET', path: `${issuePath(key)}?fields=${asked.fields.join(',')}` },
        `reading ${key}`,
      );
      return {
        key: issue.key,
        summary: issue.fields.summary,
        description: adfToText(issue.fields.description),
        labels: issue.fields.labels ?? [],
        priority: issue.fields.priority?.name ?? null,
        status: issue.fields.status?.name ?? null,
        updated: issue.fields.updated,
        subtasks: (issue.fields.subtasks ?? []).map((sub) => sub.key),
        parent: parentOf(issue.fields.parent),
        type: issueTypeOf(issue.fields.issuetype),
        team: asked.team ? teamOf(issue.fields[asked.team]) : null,
      };
    },
    async comments(key: string, limit: number) {
      const found = await client.call(
        commentsSchema,
        {
          method: 'GET',
          path: `${issuePath(key)}/comment?orderBy=-created&maxResults=${limit}`,
        },
        `reading the comments on ${key}`,
      );
      return {
        comments: found.comments.map(commentOf).toReversed(),
        total: found.total ?? found.comments.length,
      };
    },
    async comment(key: string, id: string): Promise<JiraComment> {
      return commentOf(
        await client.call(
          commentSchema,
          { method: 'GET', path: commentPath(key, id) },
          `reading comment ${id} on ${key}`,
        ),
      );
    },
    async editComment(
      key: string,
      id: string,
      body: string,
      visibility: JiraVisibility | null = null,
    ): Promise<void> {
      await client.call(
        null,
        {
          method: 'PUT',
          path: commentPath(key, id),
          body: { body: textToAdf(body), ...(visibility ? { visibility } : {}) },
        },
        `editing comment ${id} on ${key}`,
      );
    },
    async deleteComment(key: string, id: string): Promise<void> {
      await client.call(
        null,
        { method: 'DELETE', path: commentPath(key, id) },
        `deleting comment ${id} on ${key}`,
      );
    },
    async deleteIssue(key: string, withSubtasks: boolean): Promise<void> {
      await client.call(
        null,
        { method: 'DELETE', path: `${issuePath(key)}?deleteSubtasks=${withSubtasks}` },
        `deleting ${key}`,
      );
    },
  };
}

export type JiraEdits = ReturnType<typeof jiraEdits>;

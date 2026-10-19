import { z } from 'zod';
import { adfToText, textToAdf } from '../tickets/jira-adf.ts';
import { atlassianClient, type AtlassianAccess } from './access.ts';

export const JIRA = { name: 'Jira', thing: 'ticket' };

const SEARCH_FIELDS = [
  'summary',
  'status',
  'assignee',
  'priority',
  'updated',
  'project',
  'issuetype',
];
const FACT_FIELDS = [
  'summary',
  'description',
  'labels',
  'priority',
  'updated',
  'status',
  'subtasks',
];

const person = z.object({ accountId: z.string().optional(), displayName: z.string() });
const named = z.object({ name: z.string() }).nullable().optional();

const searchSchema = z.object({
  issues: z.array(
    z.object({
      key: z.string(),
      fields: z.object({
        summary: z.string(),
        status: named,
        assignee: person.nullable().optional(),
        priority: named,
        updated: z.string().optional(),
        project: z.object({ key: z.string() }).nullable().optional(),
        issuetype: named,
      }),
    }),
  ),
  nextPageToken: z.string().nullable().optional(),
});

const factsSchema = z.object({
  key: z.string(),
  fields: z.object({
    summary: z.string(),
    description: z.unknown().optional(),
    labels: z.array(z.string()).optional(),
    priority: named,
    updated: z.string(),
    status: named,
    subtasks: z.array(z.object({ key: z.string() })).optional(),
  }),
});

const commentSchema = z.object({
  id: z.string(),
  author: person.nullable().optional(),
  body: z.unknown(),
  created: z.string(),
  updated: z.string().optional(),
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
}

export interface JiraComment {
  id: string;
  authorId: string | null;
  author: string | null;
  body: string;
  createdAt: string;
  updatedAt: string | null;
}

export interface JiraFieldChange {
  summary?: string | undefined;
  description?: string | undefined;
  labels?: string[] | undefined;
  priority?: string | undefined;
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
  };
}

export function jiraEdits(access: AtlassianAccess, fetchImpl: typeof fetch) {
  const client = atlassianClient(access, fetchImpl, JIRA);
  const browse = (key: string) => `${access.siteUrl}/browse/${key}`;
  return {
    browse,
    async search(jql: string, limit: number, pageToken: string | null) {
      const found = await client.call(
        searchSchema,
        {
          method: 'POST',
          path: '/rest/api/3/search/jql',
          body: {
            jql,
            fields: SEARCH_FIELDS,
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
      const issue = await client.call(
        factsSchema,
        { method: 'GET', path: `${issuePath(key)}?fields=${FACT_FIELDS.join(',')}` },
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
    async update(key: string, change: JiraFieldChange): Promise<void> {
      const fields = {
        ...(change.summary !== undefined ? { summary: change.summary } : {}),
        ...(change.description !== undefined ? { description: textToAdf(change.description) } : {}),
        ...(change.labels !== undefined
          ? { labels: change.labels.map((label) => label.replace(/\s+/g, '-')) }
          : {}),
        ...(change.priority !== undefined ? { priority: { name: change.priority } } : {}),
      };
      await client.call(
        null,
        { method: 'PUT', path: issuePath(key), body: { fields } },
        `changing ${key}`,
      );
    },
    async editComment(key: string, id: string, body: string): Promise<void> {
      await client.call(
        null,
        { method: 'PUT', path: commentPath(key, id), body: { body: textToAdf(body) } },
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

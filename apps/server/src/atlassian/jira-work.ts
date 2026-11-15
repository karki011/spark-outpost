import { z } from 'zod';
import { adfToText, textToAdf } from '../tickets/jira-adf.ts';
import type { AtlassianClient } from './access.ts';
import { editMetaFields, type JiraFieldMeta } from './jira-meta.ts';

const issuePath = (key: string) => `/rest/api/3/issue/${encodeURIComponent(key)}`;
const person = z.object({ accountId: z.string().optional(), displayName: z.string() });

export interface JiraVisibility {
  type: 'role' | 'group';
  value: string;
}

const transitionsSchema = z.object({
  transitions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      to: z.object({ name: z.string() }).optional(),
      fields: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});

export interface JiraTransition {
  id: string;
  name: string;
  to: string | null;
  fields: JiraFieldMeta[];
}

const linkTypesSchema = z.object({
  issueLinkTypes: z.array(
    z.object({ id: z.string(), name: z.string(), inward: z.string(), outward: z.string() }),
  ),
});
export type JiraLinkType = z.infer<typeof linkTypesSchema>['issueLinkTypes'][number];

const linkSchema = z.object({
  id: z.string(),
  type: z.object({ name: z.string(), inward: z.string(), outward: z.string() }),
  inwardIssue: z.object({ key: z.string() }).optional(),
  outwardIssue: z.object({ key: z.string() }).optional(),
});

const watchersSchema = z.object({
  watchCount: z.number().optional(),
  isWatching: z.boolean().optional(),
  watchers: z.array(person).optional(),
});
const votesSchema = z.object({ votes: z.number().optional(), hasVoted: z.boolean().optional() });

const worklogSchema = z.object({
  id: z.string(),
  author: person.nullable().optional(),
  timeSpent: z.string().optional(),
  started: z.string().optional(),
  updated: z.string().optional(),
  comment: z.unknown().optional(),
});
const worklogsSchema = z.object({ worklogs: z.array(worklogSchema), total: z.number().optional() });

export interface JiraWorklog {
  id: string;
  author: string | null;
  authorId: string | null;
  timeSpent: string | null;
  started: string | null;
  updated: string | null;
  comment: string;
}

const worklogOf = (log: z.infer<typeof worklogSchema>): JiraWorklog => ({
  id: log.id,
  author: log.author?.displayName ?? null,
  authorId: log.author?.accountId ?? null,
  timeSpent: log.timeSpent ?? null,
  started: log.started ?? null,
  updated: log.updated ?? null,
  comment: adfToText(log.comment),
});

export interface WorklogInput {
  timeSpent?: string | undefined;
  started?: string | undefined;
  comment?: string | undefined;
}

const worklogBody = (input: WorklogInput) => ({
  ...(input.timeSpent ? { timeSpent: input.timeSpent } : {}),
  ...(input.started ? { started: input.started } : {}),
  ...(input.comment !== undefined ? { comment: textToAdf(input.comment) } : {}),
});

export function jiraWork(client: AtlassianClient) {
  return {
    async transitions(key: string): Promise<JiraTransition[]> {
      const found = await client.call(
        transitionsSchema,
        { method: 'GET', path: `${issuePath(key)}/transitions?expand=transitions.fields` },
        `reading the moves for ${key}`,
      );
      return found.transitions.map((transition) => ({
        id: transition.id,
        name: transition.name,
        to: transition.to?.name ?? null,
        fields: editMetaFields({ fields: transition.fields ?? {} }),
      }));
    },
    async transition(key: string, id: string, fields: Record<string, unknown>, comment?: string) {
      await client.call(
        null,
        {
          method: 'POST',
          path: `${issuePath(key)}/transitions`,
          body: {
            transition: { id },
            ...(Object.keys(fields).length > 0 ? { fields } : {}),
            ...(comment ? { update: { comment: [{ add: { body: textToAdf(comment) } }] } } : {}),
          },
        },
        `moving ${key}`,
      );
    },
    async addComment(key: string, body: string, visibility: JiraVisibility | null) {
      const created = await client.call(
        z.object({ id: z.string() }),
        {
          method: 'POST',
          path: `${issuePath(key)}/comment`,
          body: { body: textToAdf(body), ...(visibility ? { visibility } : {}) },
        },
        `commenting on ${key}`,
      );
      return created.id;
    },
    async linkTypes(): Promise<JiraLinkType[]> {
      const found = await client.call(
        linkTypesSchema,
        { method: 'GET', path: '/rest/api/3/issueLinkType' },
        'reading the link types',
      );
      return found.issueLinkTypes;
    },
    async link(type: string, inward: string, outward: string) {
      await client.call(
        null,
        {
          method: 'POST',
          path: '/rest/api/3/issueLink',
          body: {
            type: { name: type },
            inwardIssue: { key: inward },
            outwardIssue: { key: outward },
          },
        },
        `linking ${inward} and ${outward}`,
      );
    },
    async linkById(id: string) {
      return client.call(
        linkSchema,
        { method: 'GET', path: `/rest/api/3/issueLink/${encodeURIComponent(id)}` },
        `reading link ${id}`,
      );
    },
    async unlink(id: string) {
      await client.call(
        null,
        { method: 'DELETE', path: `/rest/api/3/issueLink/${encodeURIComponent(id)}` },
        `removing link ${id}`,
      );
    },
    async watchers(key: string) {
      const found = await client.call(
        watchersSchema,
        { method: 'GET', path: `${issuePath(key)}/watchers` },
        `reading the watchers of ${key}`,
      );
      return {
        count: found.watchCount ?? found.watchers?.length ?? 0,
        watching: found.isWatching ?? false,
        watchers: (found.watchers ?? []).map((watcher) => ({
          accountId: watcher.accountId ?? null,
          name: watcher.displayName,
        })),
      };
    },
    async watch(key: string, accountId: string, on: boolean) {
      await client.call(
        null,
        on
          ? { method: 'POST', path: `${issuePath(key)}/watchers`, body: accountId }
          : {
              method: 'DELETE',
              path: `${issuePath(key)}/watchers?accountId=${encodeURIComponent(accountId)}`,
            },
        `${on ? 'adding' : 'removing'} a watcher on ${key}`,
      );
    },
    async votes(key: string) {
      const found = await client.call(
        votesSchema,
        { method: 'GET', path: `${issuePath(key)}/votes` },
        `reading the votes on ${key}`,
      );
      return { votes: found.votes ?? 0, voted: found.hasVoted ?? false };
    },
    async vote(key: string, on: boolean) {
      await client.call(
        null,
        { method: on ? 'POST' : 'DELETE', path: `${issuePath(key)}/votes` },
        `${on ? 'voting for' : 'removing your vote on'} ${key}`,
      );
    },
    async worklogs(key: string, limit: number) {
      const found = await client.call(
        worklogsSchema,
        { method: 'GET', path: `${issuePath(key)}/worklog?maxResults=${limit}` },
        `reading the work logs on ${key}`,
      );
      return {
        worklogs: found.worklogs.map(worklogOf),
        total: found.total ?? found.worklogs.length,
      };
    },
    async worklog(key: string, id: string) {
      return worklogOf(
        await client.call(
          worklogSchema,
          { method: 'GET', path: `${issuePath(key)}/worklog/${encodeURIComponent(id)}` },
          `reading work log ${id} on ${key}`,
        ),
      );
    },
    async addWorklog(key: string, input: WorklogInput) {
      const created = await client.call(
        z.object({ id: z.string() }),
        { method: 'POST', path: `${issuePath(key)}/worklog`, body: worklogBody(input) },
        `logging work on ${key}`,
      );
      return created.id;
    },
    async editWorklog(key: string, id: string, input: WorklogInput) {
      await client.call(
        null,
        {
          method: 'PUT',
          path: `${issuePath(key)}/worklog/${encodeURIComponent(id)}`,
          body: worklogBody(input),
        },
        `changing work log ${id} on ${key}`,
      );
    },
    async deleteWorklog(key: string, id: string) {
      await client.call(
        null,
        { method: 'DELETE', path: `${issuePath(key)}/worklog/${encodeURIComponent(id)}` },
        `deleting work log ${id} on ${key}`,
      );
    },
  };
}

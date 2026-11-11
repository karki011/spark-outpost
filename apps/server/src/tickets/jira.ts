import { z } from 'zod';
import type { TicketDetail, TicketPriorityName, TicketSummary } from '@spark-outpost/contracts';
import { callJson, failure, isOk, type JsonCall } from './http.ts';
import { adfToText, textToAdf } from './jira-adf.ts';
import { DEV_STATUS_TIMEOUT_MS, readJiraDevelopment } from './jira-development.ts';
import { jiraRelationFields, readJiraRelations } from './jira-relations.ts';
import { projectOfKey } from './ticket-relations.ts';
import { JIRA_EXTRA_FIELDS, jiraExtraFieldsShape, jiraExtras } from './jira-fields.ts';
import {
  KEY_QUERY,
  isTruncated,
  markTruncated,
  matchesFilter,
  SEARCH_PAGE_SIZE,
  TicketApiError,
  type TicketFilter,
  type TicketSearchFilter,
  type TicketSource,
} from './source.ts';
import {
  effectiveMap,
  planMove,
  settingsFor,
  type MoveRequest,
  type SourceMoveSettings,
} from './move-target.ts';
import { bucketOf, sameName, type SourceState, type StateKind } from './status.ts';

const NAME = 'Jira';
const DEFAULT_TYPE = 'Task';
const JIRA_PRIORITY: Record<TicketPriorityName, string> = {
  urgent: 'Highest',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
const createdSchema = z.object({ key: z.string() });
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const SPRINT_FIELD = 'customfield_10020';
const SUMMARY_FIELDS = [
  'summary',
  'status',
  'updated',
  'priority',
  'project',
  SPRINT_FIELD,
  ...JIRA_EXTRA_FIELDS,
];
const DETAIL_FIELDS = [
  ...SUMMARY_FIELDS,
  'description',
  'assignee',
  'labels',
  'comment',
  'parent',
  'issuelinks',
  'subtasks',
];

const dateSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)));
const statusSchema = z.object({
  name: z.string(),
  statusCategory: z.object({ key: z.string() }).optional(),
});
const named = z.object({ name: z.string() }).nullable().optional();
const sprintSchema = z
  .array(z.object({ name: z.string(), state: z.string().optional() }))
  .nullable()
  .optional()
  .catch(null);
const fieldsSchema = z.object({
  summary: z.string(),
  status: statusSchema,
  updated: dateSchema,
  priority: named,
  project: z.object({ key: z.string() }).nullable().optional(),
  issuetype: named,
  [SPRINT_FIELD]: sprintSchema,
  ...jiraExtraFieldsShape,
});
const issueSchema = z.object({ id: z.string().optional(), key: z.string(), fields: fieldsSchema });
const issueIdSchema = z.object({ id: z.string() });
const detailSchema = z.object({
  id: z.string().optional(),
  key: z.string(),
  fields: fieldsSchema.extend({
    description: z.unknown().optional(),
    assignee: z.object({ displayName: z.string() }).nullable().optional(),
    labels: z.array(z.string()).optional(),
    comment: z
      .object({
        comments: z.array(
          z.object({
            author: z.object({ displayName: z.string() }).nullable().optional(),
            body: z.unknown(),
            created: dateSchema,
          }),
        ),
      })
      .optional(),
    ...jiraRelationFields,
  }),
});
const remoteLinksSchema = z.array(
  z.object({ object: z.object({ url: z.string(), title: z.string().optional() }) }),
);
const transitionsSchema = z.object({
  transitions: z.array(z.object({ id: z.string(), name: z.string(), to: statusSchema })),
});
const projectStatusesSchema = z.array(
  z.object({ name: z.string(), statuses: z.array(statusSchema) }),
);
const myselfSchema = z.object({
  accountId: z.string(),
  displayName: z.string(),
  emailAddress: z.string().nullable().optional(),
});

export function jiraKind(categoryKey: string | undefined): StateKind {
  if (categoryKey === 'indeterminate') return 'started';
  if (categoryKey === 'done') return 'done';
  return 'todo';
}

export function jqlString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function assignedJql(filter: TicketFilter): string {
  const clauses = ['assignee = currentUser()'];
  clauses.push(filter.status === 'done' ? 'statusCategory = Done' : 'statusCategory != Done');
  if (filter.project) clauses.push(`project = ${jqlString(filter.project)}`);
  if (filter.q) clauses.push(`text ~ ${jqlString(filter.q)}`);
  if (filter.doneWithinDays) clauses.push(`resolved >= -${filter.doneWithinDays}d`);
  return `${clauses.join(' AND ')} ORDER BY updated DESC`;
}

const ASSIGNEE_JQL = {
  anyone: null,
  me: 'assignee = currentUser()',
  unassigned: 'assignee is EMPTY',
  others: 'assignee != currentUser() AND assignee is not EMPTY',
} as const;

export function searchJql(filter: TicketSearchFilter): string {
  const clauses: string[] = [];
  const q = filter.q.trim();
  if (KEY_QUERY.test(q)) clauses.push(`key = ${jqlString(q.toUpperCase())}`);
  else if (q) clauses.push(`text ~ ${jqlString(q)}`);
  clauses.push(filter.status === 'done' ? 'statusCategory = Done' : 'statusCategory != Done');
  if (filter.project) clauses.push(`project = ${jqlString(filter.project)}`);
  const assignee = ASSIGNEE_JQL[filter.assignee];
  if (assignee) clauses.push(assignee);
  return `${clauses.join(' AND ')} ORDER BY updated DESC`;
}

export interface JiraAccess {
  siteUrl: string;
  email: string;
  apiToken: string;
}

export function jiraSource(
  access: JiraAccess,
  moves: SourceMoveSettings,
  fetchImpl: typeof fetch,
): TicketSource {
  const authorization = `Basic ${Buffer.from(`${access.email}:${access.apiToken}`).toString('base64')}`;
  const issuePath = (key: string) => `/rest/api/3/issue/${encodeURIComponent(key)}`;
  const issueIds = new Map<string, string>();

  async function call<T>(
    schema: z.ZodType<T> | null,
    request: Omit<JsonCall, 'authorization' | 'url'> & { path: string },
    action: string,
  ): Promise<T> {
    const answer = await callJson(fetchImpl, NAME, {
      method: request.method,
      url: `${access.siteUrl}${request.path}`,
      authorization,
      body: request.body,
    });
    if (!isOk(answer)) throw failure(NAME, action, answer);
    if (!schema) return undefined as T;
    const parsed = schema.safeParse(answer.data);
    if (!parsed.success)
      throw new TicketApiError(502, `Jira sent an unexpected answer while ${action}.`);
    return parsed.data;
  }

  const stateOf = (status: z.infer<typeof statusSchema>): SourceState => ({
    name: status.name,
    kind: jiraKind(status.statusCategory?.key),
  });
  const bucket = (status: z.infer<typeof statusSchema>, project: string | null) =>
    bucketOf(stateOf(status), effectiveMap(settingsFor(moves, project)));

  async function statusesOf(project: string, issueType: string | null): Promise<SourceState[]> {
    const types = await call(
      projectStatusesSchema,
      { method: 'GET', path: `/rest/api/3/project/${encodeURIComponent(project)}/statuses` },
      `reading the statuses of ${project}`,
    );
    const own = types.filter((type) => issueType !== null && sameName(type.name, issueType));
    const byName = new Map<string, SourceState>();
    for (const status of (own.length > 0 ? own : types).flatMap((type) => type.statuses)) {
      byName.set(status.name.trim().toLowerCase(), stateOf(status));
    }
    return [...byName.values()];
  }

  async function gatherMove(key: string, request: MoveRequest) {
    const fields = [...SUMMARY_FIELDS, 'issuetype'].join(',');
    const issue = await call(
      issueSchema,
      { method: 'GET', path: `${issuePath(key)}?fields=${fields}` },
      `reading ${key}`,
    );
    const { project } = summary(issue);
    const [statuses, { transitions }] = await Promise.all([
      project ? statusesOf(project, issue.fields.issuetype?.name ?? null) : [],
      call(
        transitionsSchema,
        { method: 'GET', path: `${issuePath(key)}/transitions` },
        `reading the transitions for ${key}`,
      ),
    ]);
    const plan = planMove({
      key: issue.key,
      sourceName: NAME,
      project,
      current: stateOf(issue.fields.status),
      statuses,
      reachable: transitions.map((transition) => stateOf(transition.to)),
      request,
      settings: settingsFor(moves, project),
    });
    const { to } = plan;
    const next = to ? transitions.find((transition) => sameName(transition.to.name, to)) : null;
    return { plan, transitionId: next?.id ?? null };
  }

  async function issueIdOf(key: string): Promise<string> {
    const known = issueIds.get(key);
    if (known) return known;
    const issue = await call(
      issueIdSchema,
      { method: 'GET', path: `${issuePath(key)}?fields=summary` },
      `reading ${key}`,
    );
    return issue.id;
  }

  async function devStatus(path: string, deadline: number): Promise<unknown> {
    const answer = await callJson(fetchImpl, NAME, {
      method: 'GET',
      url: `${access.siteUrl}${path}`,
      authorization,
      timeoutMs: Math.max(1, deadline - Date.now()),
    });
    if (!isOk(answer)) throw failure(NAME, 'reading development information', answer);
    return answer.data;
  }

  function summary(issue: z.infer<typeof issueSchema>): TicketSummary {
    if (issue.id) issueIds.set(issue.key, issue.id);
    const project = issue.fields.project?.key ?? issue.key.split('-')[0] ?? null;
    const sprints = issue.fields[SPRINT_FIELD] ?? [];
    const sprint = sprints.find((entry) => entry.state === 'active') ?? sprints.at(-1);
    return {
      source: 'jira',
      key: issue.key,
      title: issue.fields.summary,
      status: bucket(issue.fields.status, project),
      statusName: issue.fields.status.name,
      url: `${access.siteUrl}/browse/${issue.key}`,
      updatedAt: new Date(issue.fields.updated).toISOString(),
      project,
      priority: issue.fields.priority?.name ?? null,
      sprint: sprint?.name ?? null,
      ...jiraExtras(issue.fields),
    };
  }

  const pageSchema = z.object({
    issues: z.array(issueSchema),
    nextPageToken: z.string().nullable().optional(),
  });

  async function searchIssues(jql: string, maxResults: number, action: string, maxPages = 1) {
    const found: TicketSummary[] = [];
    let pageToken: string | null = null;
    let more = false;
    for (let page = 0; page < maxPages; page += 1) {
      const answer: z.infer<typeof pageSchema> = await call(
        pageSchema,
        {
          method: 'POST',
          path: '/rest/api/3/search/jql',
          body: {
            jql,
            fields: SUMMARY_FIELDS,
            maxResults,
            ...(pageToken ? { nextPageToken: pageToken } : {}),
          },
        },
        action,
      );
      found.push(...answer.issues.map(summary));
      pageToken = answer.nextPageToken || null;
      more = pageToken !== null;
      if (!pageToken || answer.issues.length === 0) break;
    }
    return markTruncated(found, more);
  }

  return {
    id: 'jira',
    async whoami() {
      const me = await call(
        myselfSchema,
        { method: 'GET', path: '/rest/api/3/myself' },
        'checking who you are',
      );
      return { id: me.accountId, name: me.emailAddress ?? me.displayName };
    },
    async listAssigned(filter) {
      const found = await searchIssues(
        assignedJql(filter),
        PAGE_SIZE,
        'listing your tickets',
        MAX_PAGES,
      );
      return markTruncated(
        found.filter((ticket) => matchesFilter(ticket, filter)),
        isTruncated(found),
      );
    },
    async search(filter) {
      return searchIssues(searchJql(filter), SEARCH_PAGE_SIZE, 'searching tickets');
    },
    async getSummary(key) {
      const issue = await call(
        issueSchema,
        { method: 'GET', path: `${issuePath(key)}?fields=${SUMMARY_FIELDS.join(',')}` },
        `reading ${key}`,
      );
      return summary(issue);
    },
    async assign(key, accountId) {
      await call(
        null,
        { method: 'PUT', path: `${issuePath(key)}/assignee`, body: { accountId } },
        `assigning ${key}`,
      );
    },
    async getTicket(key) {
      const fields = DETAIL_FIELDS.join(',');
      const issue = await call(
        detailSchema,
        { method: 'GET', path: `${issuePath(key)}?fields=${fields}` },
        `reading ${key}`,
      );
      const remote = await call(
        remoteLinksSchema,
        { method: 'GET', path: `${issuePath(key)}/remotelink` },
        `reading the links on ${key}`,
      );
      const base = summary(issue);
      const relations = readJiraRelations(issue.fields, {
        siteUrl: access.siteUrl,
        bucket: (status, related) => bucket(status, projectOfKey(related, base.project)),
      });
      const detail: TicketDetail = {
        ...base,
        description: adfToText(issue.fields.description),
        assignee: issue.fields.assignee?.displayName ?? null,
        labels: issue.fields.labels ?? [],
        comments: (issue.fields.comment?.comments ?? []).map((comment) => ({
          author: comment.author?.displayName ?? null,
          body: adfToText(comment.body),
          createdAt: new Date(comment.created).toISOString(),
        })),
        links: remote.map((link) => ({
          title: link.object.title ?? link.object.url,
          url: link.object.url,
        })),
        subtasks: relations.subtasks,
        subtasksMore: relations.subtasksMore,
        parent: relations.parent,
        relations: relations.relations,
      };
      return detail;
    },
    async planMove(key, request) {
      return (await gatherMove(key, request)).plan;
    },
    async transition(key, request) {
      const { plan, transitionId } = await gatherMove(key, request);
      if (!transitionId) return { ...plan, moved: false };
      await call(
        null,
        {
          method: 'POST',
          path: `${issuePath(key)}/transitions`,
          body: { transition: { id: transitionId } },
        },
        `moving ${key}`,
      );
      return { ...plan, moved: true };
    },
    projectStatuses: (project) => statusesOf(project, null),
    async comment(key, body) {
      await call(
        null,
        { method: 'POST', path: `${issuePath(key)}/comment`, body: { body: textToAdf(body) } },
        `commenting on ${key}`,
      );
    },
    async create(ticket) {
      const fields = {
        project: { key: ticket.project },
        summary: ticket.title,
        description: textToAdf(ticket.description),
        issuetype: { name: ticket.type ?? DEFAULT_TYPE },
        ...(ticket.priority ? { priority: { name: JIRA_PRIORITY[ticket.priority] } } : {}),
        ...(ticket.labels.length > 0
          ? { labels: ticket.labels.map((label) => label.replace(/\s+/g, '-')) }
          : {}),
        ...(ticket.assigneeId ? { assignee: { accountId: ticket.assigneeId } } : {}),
      };
      const created = await call(
        createdSchema,
        { method: 'POST', path: '/rest/api/3/issue', body: { fields } },
        'creating the ticket',
      );
      return {
        key: created.key,
        url: `${access.siteUrl}/browse/${created.key}`,
        skippedLabels: [],
      };
    },
    async development(key) {
      const deadline = Date.now() + DEV_STATUS_TIMEOUT_MS;
      const issueId = await issueIdOf(key);
      return readJiraDevelopment((path) => devStatus(path, deadline), issueId);
    },
    async linkPullRequest(key, pull) {
      await call(
        null,
        {
          method: 'POST',
          path: `${issuePath(key)}/remotelink`,
          body: { globalId: pull.url, object: { url: pull.url, title: pull.title } },
        },
        `linking the pull request to ${key}`,
      );
    },
  };
}

import { z } from 'zod';
import type {
  TicketPriorityName,
  TicketDetail,
  TicketStatus,
  TicketSummary,
} from '@spark-outpost/contracts';
import { callJson, failure, isOk } from './http.ts';
import {
  daysAgo,
  KEY_QUERY,
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

export const LINEAR_API_URL = 'https://api.linear.app/graphql';
const NAME = 'Linear';
const PAGE_SIZE = 100;

const stateSchema = z.object({ id: z.string().optional(), name: z.string(), type: z.string() });
const issueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  url: z.string(),
  updatedAt: z.string(),
  priorityLabel: z.string().nullable().optional(),
  priority: z.number().int().min(0).max(4).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  creator: z.object({ name: z.string() }).nullable().optional(),
  assignee: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
  labels: z.object({ nodes: z.array(z.object({ name: z.string() })) }).optional(),
  state: stateSchema,
  team: z.object({ key: z.string() }).nullable().optional(),
  cycle: z
    .object({ name: z.string().nullable().optional(), number: z.number() })
    .nullable()
    .optional(),
});
const nodes = <T extends z.ZodType>(item: T) => z.object({ nodes: z.array(item) });
const detailSchema = issueSchema.extend({
  description: z.string().nullable().optional(),
  comments: nodes(
    z.object({
      body: z.string(),
      createdAt: z.string(),
      user: z.object({ name: z.string() }).nullable().optional(),
    }),
  ),
  attachments: nodes(z.object({ title: z.string().nullable(), url: z.string() })),
  children: nodes(z.object({ identifier: z.string(), title: z.string(), state: stateSchema })),
});
const teamStatesSchema = z.object({
  issue: z.object({
    id: z.string(),
    state: stateSchema,
    team: z.object({ key: z.string(), states: nodes(stateSchema.extend({ id: z.string() })) }),
  }),
});
const successSchema = (field: string) =>
  z.object({ [field]: z.object({ success: z.boolean() }) }) as z.ZodType<
    Record<string, { success: boolean }>
  >;

const ISSUE_FIELDS = `id identifier title url updatedAt priorityLabel priority dueDate completedAt
  createdAt creator { name } assignee { id name } labels { nodes { name } }
  state { name type } team { key } cycle { name number }`;

const VIEWER = 'query { viewer { id name email } }';
const ASSIGNED = `query Assigned($first: Int!, $filter: IssueFilter) {
  viewer { assignedIssues(first: $first, filter: $filter, orderBy: updatedAt) {
    nodes { ${ISSUE_FIELDS} } } } }`;
const SEARCH = `query Search($first: Int!, $filter: IssueFilter) {
  issues(first: $first, filter: $filter, orderBy: updatedAt) { nodes { ${ISSUE_FIELDS} } } }`;
const SUMMARY = `query Summary($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`;
const ISSUE = `query Issue($id: String!) { issue(id: $id) { ${ISSUE_FIELDS}
  description
  comments(first: 50) { nodes { body createdAt user { name } } }
  attachments { nodes { title url } }
  children { nodes { identifier title state { name type } } } } }`;
const TEAM_STATES = `query States($id: String!) { issue(id: $id) { id state { name type }
  team { key states { nodes { id name type } } } } }`;
const MOVE = `mutation Move($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success } }`;
const COMMENT = `mutation Comment($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) { success } }`;
const ASSIGN = `mutation Assign($id: String!, $assigneeId: String) {
  issueUpdate(id: $id, input: { assigneeId: $assigneeId }) { success } }`;
const LINK = `mutation Link($issueId: String!, $url: String!, $title: String!) {
  attachmentLinkURL(issueId: $issueId, url: $url, title: $title) { success } }`;

const TEAM = `query Team($key: String!) {
  teams(filter: { key: { eqIgnoreCase: $key } }) {
    nodes { id key labels { nodes { id name } } } } }`;
const TEAM_STATUSES = `query TeamStatuses($key: String!) {
  teams(filter: { key: { eqIgnoreCase: $key } }) { nodes { states { nodes { name type } } } } }`;
const teamStatusesSchema = z.object({
  teams: nodes(z.object({ states: nodes(z.object({ name: z.string(), type: z.string() })) })),
});
const CREATE = `mutation Create($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { identifier url } } }`;
const teamSchema = z.object({
  teams: nodes(
    z.object({
      id: z.string(),
      key: z.string(),
      labels: nodes(z.object({ id: z.string(), name: z.string() })),
    }),
  ),
});
const createdSchema = z.object({
  issueCreate: z.object({
    success: z.boolean(),
    issue: z.object({ identifier: z.string(), url: z.string() }).nullable(),
  }),
});
const LINEAR_PRIORITY: Record<TicketPriorityName, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

const DONE_TYPES = ['completed', 'canceled'];

export function linearKind(type: string): StateKind {
  if (type === 'started') return 'started';
  if (DONE_TYPES.includes(type)) return 'done';
  return 'todo';
}

const stateOf = (state: { name: string; type: string }): SourceState => ({
  name: state.name,
  kind: linearKind(state.type),
});

export function linearTextFilter(q: string) {
  const key = KEY_QUERY.exec(q.trim());
  if (key) {
    return { team: { key: { eqIgnoreCase: key[1] } }, number: { eq: Number(key[2]) } };
  }
  return {
    or: [{ title: { containsIgnoreCase: q } }, { description: { containsIgnoreCase: q } }],
  };
}

const ASSIGNEE_FILTERS = {
  anyone: null,
  me: { isMe: { eq: true } },
  unassigned: { null: true },
  others: { null: false, isMe: { eq: false } },
} as const;

function authError(errors: unknown): boolean {
  return JSON.stringify(errors ?? '')
    .toLowerCase()
    .includes('authentication');
}

export function linearSource(
  apiKey: string,
  moves: SourceMoveSettings,
  fetchImpl: typeof fetch,
  apiUrl = LINEAR_API_URL,
): TicketSource {
  async function graphql<T>(
    schema: z.ZodType<T>,
    query: string,
    variables: Record<string, unknown>,
    action: string,
  ): Promise<T> {
    const answer = await callJson(fetchImpl, NAME, {
      method: 'POST',
      url: apiUrl,
      authorization: apiKey,
      body: { query, variables },
    });
    const errors = (answer.data as { errors?: unknown } | null)?.errors;
    if (authError(errors)) throw failure(NAME, action, { status: 401, data: null });
    if (!isOk(answer) || errors) {
      throw failure(NAME, action, {
        status: isOk(answer) ? 502 : answer.status,
        data: answer.data,
      });
    }
    const parsed = schema.safeParse((answer.data as { data?: unknown } | null)?.data);
    if (!parsed.success)
      throw new TicketApiError(502, `Linear sent an unexpected answer while ${action}.`);
    return parsed.data;
  }

  const bucket = (state: z.infer<typeof stateSchema>, team: string | null) =>
    bucketOf(stateOf(state), effectiveMap(settingsFor(moves, team)));

  async function gatherMove(key: string, request: MoveRequest) {
    const { issue } = await graphql(teamStatesSchema, TEAM_STATES, { id: key }, `reading ${key}`);
    const states = issue.team.states.nodes;
    const plan = planMove({
      key,
      sourceName: NAME,
      project: issue.team.key,
      current: stateOf(issue.state),
      statuses: states.map(stateOf),
      reachable: null,
      request,
      settings: settingsFor(moves, issue.team.key),
    });
    const { to } = plan;
    const next = to ? states.find((state) => sameName(state.name, to)) : null;
    return { plan, issueId: issue.id, stateId: next?.id ?? null };
  }

  function summary(issue: z.infer<typeof issueSchema>): TicketSummary {
    const team = issue.team?.key ?? null;
    return {
      source: 'linear',
      key: issue.identifier,
      title: issue.title,
      status: bucket(issue.state, team),
      statusName: issue.state.name,
      url: issue.url,
      updatedAt: issue.updatedAt,
      project: team,
      priority: issue.priorityLabel ?? null,
      sprint: issue.cycle ? (issue.cycle.name ?? `Cycle ${issue.cycle.number}`) : null,
      priorityRank: issue.priority ?? 0,
      assignedTo: issue.assignee ?? null,
      labels: issue.labels?.nodes.map((label) => label.name) ?? [],
      dueDate: issue.dueDate ?? null,
      doneAt: issue.completedAt ?? null,
      reporter: issue.creator ? { name: issue.creator.name } : null,
      createdAt: issue.createdAt ?? null,
    };
  }

  function stateFilter(status: TicketStatus | undefined) {
    return status === 'done' ? { type: { in: DONE_TYPES } } : { type: { nin: DONE_TYPES } };
  }

  function searchFilter(filter: TicketSearchFilter) {
    const assignee = ASSIGNEE_FILTERS[filter.assignee];
    return {
      state: stateFilter(filter.status),
      ...(filter.project ? { team: { key: { eqIgnoreCase: filter.project } } } : {}),
      ...(assignee ? { assignee } : {}),
      ...(filter.q ? linearTextFilter(filter.q) : {}),
    };
  }

  async function readSummary(key: string) {
    const schema = z.object({ issue: issueSchema.nullable() });
    const { issue } = await graphql(schema, SUMMARY, { id: key }, `reading ${key}`);
    if (!issue) throw new TicketApiError(404, `Linear has no ticket ${key}.`);
    return summary(issue);
  }

  return {
    id: 'linear',
    async whoami() {
      const schema = z.object({
        viewer: z.object({ id: z.string(), name: z.string(), email: z.string().nullable() }),
      });
      const { viewer } = await graphql(schema, VIEWER, {}, 'checking who you are');
      return { id: viewer.id, name: viewer.email ?? viewer.name };
    },
    async listAssigned(filter: TicketFilter) {
      const schema = z.object({ viewer: z.object({ assignedIssues: nodes(issueSchema) }) });
      const variables = {
        first: PAGE_SIZE,
        filter: {
          state: stateFilter(filter.status),
          ...(filter.project ? { team: { key: { eqIgnoreCase: filter.project } } } : {}),
          ...(filter.doneWithinDays
            ? { completedAt: { gte: daysAgo(filter.doneWithinDays).toISOString() } }
            : {}),
        },
      };
      const data = await graphql(schema, ASSIGNED, variables, 'listing your tickets');
      return data.viewer.assignedIssues.nodes.map(summary).filter((t) => matchesFilter(t, filter));
    },
    async search(filter) {
      const schema = z.object({ issues: nodes(issueSchema) });
      const variables = { first: SEARCH_PAGE_SIZE, filter: searchFilter(filter) };
      const data = await graphql(schema, SEARCH, variables, 'searching tickets');
      return data.issues.nodes.map(summary);
    },
    getSummary: readSummary,
    async assign(key, accountId) {
      await graphql(
        successSchema('issueUpdate'),
        ASSIGN,
        { id: key, assigneeId: accountId },
        `assigning ${key}`,
      );
    },
    async getTicket(key) {
      const schema = z.object({ issue: detailSchema.nullable() });
      const { issue } = await graphql(schema, ISSUE, { id: key }, `reading ${key}`);
      if (!issue) throw new TicketApiError(404, `Linear has no ticket ${key}.`);
      const team = issue.team?.key ?? null;
      const detail: TicketDetail = {
        ...summary(issue),
        description: issue.description ?? '',
        assignee: issue.assignee?.name ?? null,
        comments: issue.comments.nodes.map((comment) => ({
          author: comment.user?.name ?? null,
          body: comment.body,
          createdAt: comment.createdAt,
        })),
        links: issue.attachments.nodes.map((link) => ({
          title: link.title ?? link.url,
          url: link.url,
        })),
        subtasks: issue.children.nodes.map((child) => ({
          key: child.identifier,
          title: child.title,
          status: bucket(child.state, team),
          statusName: child.state.name,
        })),
      };
      return detail;
    },
    async planMove(key, request) {
      return (await gatherMove(key, request)).plan;
    },
    async transition(key, request) {
      const { plan, issueId, stateId } = await gatherMove(key, request);
      if (!stateId) return { ...plan, moved: false };
      await graphql(successSchema('issueUpdate'), MOVE, { id: issueId, stateId }, `moving ${key}`);
      return { ...plan, moved: true };
    },
    async projectStatuses(project) {
      const { teams } = await graphql(
        teamStatusesSchema,
        TEAM_STATUSES,
        { key: project },
        `reading the statuses of ${project}`,
      );
      return (teams.nodes[0]?.states.nodes ?? []).map(stateOf);
    },
    async comment(key, body) {
      await graphql(
        successSchema('commentCreate'),
        COMMENT,
        { issueId: key, body },
        `commenting on ${key}`,
      );
    },
    async create(ticket) {
      const { teams } = await graphql(
        teamSchema,
        TEAM,
        { key: ticket.project },
        'finding the team',
      );
      const team = teams.nodes[0];
      if (!team) throw new TicketApiError(404, `Linear has no team ${ticket.project}.`);
      const known = new Map(team.labels.nodes.map((label) => [label.name.toLowerCase(), label.id]));
      const labelIds = ticket.labels.flatMap((name) => known.get(name.toLowerCase()) ?? []);
      const input = {
        teamId: team.id,
        title: ticket.title,
        description: ticket.description,
        ...(ticket.priority ? { priority: LINEAR_PRIORITY[ticket.priority] } : {}),
        ...(labelIds.length > 0 ? { labelIds } : {}),
        ...(ticket.assigneeId ? { assigneeId: ticket.assigneeId } : {}),
      };
      const { issueCreate } = await graphql(
        createdSchema,
        CREATE,
        { input },
        'creating the ticket',
      );
      if (!issueCreate.success || !issueCreate.issue) {
        throw new TicketApiError(502, 'Linear did not create the ticket.');
      }
      return {
        key: issueCreate.issue.identifier,
        url: issueCreate.issue.url,
        skippedLabels: ticket.labels.filter((name) => !known.has(name.toLowerCase())),
      };
    },
    async linkPullRequest(key, pull) {
      await graphql(
        successSchema('attachmentLinkURL'),
        LINK,
        { issueId: key, url: pull.url, title: pull.title },
        `linking the pull request to ${key}`,
      );
    },
  };
}

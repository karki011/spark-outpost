import { z } from 'zod';
import type {
  TicketDetail,
  TicketStatus,
  TicketStatusMap,
  TicketSummary,
} from '@spark-outpost/contracts';
import { callJson, failure, isOk } from './http.ts';
import { matchesFilter, TicketApiError, type TicketFilter, type TicketSource } from './source.ts';
import {
  bucketOf,
  noStateMessage,
  pickState,
  projectMap,
  shouldMove,
  type StateKind,
} from './status.ts';

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
  assignee: z.object({ name: z.string() }).nullable().optional(),
  labels: nodes(z.object({ name: z.string() })),
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

const ISSUE_FIELDS = `id identifier title url updatedAt priorityLabel
  state { name type } team { key } cycle { name number }`;

const VIEWER = 'query { viewer { id name email } }';
const ASSIGNED = `query Assigned($first: Int!, $filter: IssueFilter) {
  viewer { assignedIssues(first: $first, filter: $filter, orderBy: updatedAt) {
    nodes { ${ISSUE_FIELDS} } } } }`;
const ISSUE = `query Issue($id: String!) { issue(id: $id) { ${ISSUE_FIELDS}
  description assignee { name } labels { nodes { name } }
  comments(first: 50) { nodes { body createdAt user { name } } }
  attachments { nodes { title url } }
  children { nodes { identifier title state { name type } } } } }`;
const TEAM_STATES = `query States($id: String!) { issue(id: $id) { id state { name type }
  team { key states { nodes { id name type } } } } }`;
const MOVE = `mutation Move($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success } }`;
const COMMENT = `mutation Comment($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) { success } }`;
const LINK = `mutation Link($issueId: String!, $url: String!, $title: String!) {
  attachmentLinkURL(issueId: $issueId, url: $url, title: $title) { success } }`;

const DONE_TYPES = ['completed', 'canceled'];

export function linearKind(type: string): StateKind {
  if (type === 'started') return 'started';
  if (DONE_TYPES.includes(type)) return 'done';
  return 'todo';
}

function authError(errors: unknown): boolean {
  return JSON.stringify(errors ?? '')
    .toLowerCase()
    .includes('authentication');
}

export function linearSource(
  apiKey: string,
  statusMap: TicketStatusMap,
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
    bucketOf({ name: state.name, kind: linearKind(state.type) }, projectMap(statusMap, team));

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
    };
  }

  function stateFilter(status: TicketStatus | undefined) {
    return status === 'done' ? { type: { in: DONE_TYPES } } : { type: { nin: DONE_TYPES } };
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
        },
      };
      const data = await graphql(schema, ASSIGNED, variables, 'listing your tickets');
      return data.viewer.assignedIssues.nodes.map(summary).filter((t) => matchesFilter(t, filter));
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
        labels: issue.labels.nodes.map((label) => label.name),
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
    async transition(key, target) {
      const { issue } = await graphql(teamStatesSchema, TEAM_STATES, { id: key }, `reading ${key}`);
      const mapped = projectMap(statusMap, issue.team.key);
      const decision = shouldMove(bucket(issue.state, issue.team.key), target);
      if (!decision.move) {
        return { moved: false, statusName: issue.state.name, message: decision.reason };
      }
      const states = issue.team.states.nodes.map((state) => ({
        ...state,
        kind: linearKind(state.type),
      }));
      const next = pickState(states, target, mapped);
      if (!next) {
        return {
          moved: false,
          statusName: issue.state.name,
          message: noStateMessage(target, issue.team.key),
        };
      }
      await graphql(
        successSchema('issueUpdate'),
        MOVE,
        { id: issue.id, stateId: next.id },
        `moving ${key}`,
      );
      return { moved: true, statusName: next.name, message: null };
    },
    async comment(key, body) {
      await graphql(
        successSchema('commentCreate'),
        COMMENT,
        { issueId: key, body },
        `commenting on ${key}`,
      );
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

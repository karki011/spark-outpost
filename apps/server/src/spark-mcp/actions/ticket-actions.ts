import { z } from 'zod';
import {
  SPARK_LABELS_MAX,
  SPARK_TEXT_MAX,
  SPARK_TITLE_MAX,
  isTicketKey,
  ticketKeyHint,
  ticketKeySchema,
  ticketPriorityNameSchema,
  ticketSourceIdSchema,
  ticketStatusSchema,
  type SparkAction,
  type TicketSourceId,
} from '@spark-outpost/contracts';
import { recordTicketEvent } from '../../persistence/ticket-events.ts';
import { assignTicket } from '../../tickets/assign.ts';
import { connectedSources, requireSource, type TicketDeps } from '../../tickets/connections.ts';
import { createTicket } from '../../tickets/create.ts';
import type { MoveRequest } from '../../tickets/move-target.ts';
import { moveTicket } from '../../tickets/sync.ts';
import { ticketDepsFor } from '../deps.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';
import { ACTION_NOTE } from './action-note.ts';
import { proposeAction } from './confirm.ts';
import type { Performed } from './performed.ts';

const sourceInput = ticketSourceIdSchema.optional().describe('Defaults to the only connected one.');
const keyInput = ticketKeySchema.describe('Ticket key, such as ENG-12.');

export async function pickSource(deps: TicketDeps, requested: TicketSourceId | undefined) {
  if (requested) return requested;
  const connected = await connectedSources(deps);
  if (connected.length === 1) return connected[0]!.connection.source;
  if (connected.length === 0) {
    throw new SparkToolError('No ticket source is connected. Connect Jira or Linear in Settings.');
  }
  throw new SparkToolError('Both Jira and Linear are connected; pass source.');
}

async function ticketOf(deps: TicketDeps, source: TicketSourceId, key: string) {
  if (!isTicketKey(key, source)) throw new SparkToolError(ticketKeyHint(source));
  const open = await requireSource(deps, source);
  const summary = await open.source.getSummary(key);
  return {
    open,
    summary,
    ref: { source, key: summary.key, title: summary.title, url: summary.url },
  };
}

const createInput = {
  source: sourceInput,
  project: z.string().trim().min(1).max(100).describe('Linear team key or Jira project key.'),
  title: z.string().trim().min(1).max(SPARK_TITLE_MAX),
  description: z.string().max(SPARK_TEXT_MAX).default(''),
  type: z.string().trim().max(60).optional().describe('Jira issue type, such as Bug or Task.'),
  priority: ticketPriorityNameSchema.optional(),
  labels: z.array(z.string().trim().min(1).max(100)).max(SPARK_LABELS_MAX).default([]),
  assignToMe: z.boolean().default(false),
};

async function create(context: SparkToolContext, args: z.output<z.ZodObject<typeof createInput>>) {
  const deps = ticketDepsFor(context.deps, context.scope);
  const source = await pickSource(deps, args.source);
  await requireSource(deps, source);
  const action: SparkAction = {
    action: 'create_ticket',
    source,
    project: args.project,
    title: args.title,
    description: args.description,
    type: args.type ?? null,
    priority: args.priority ?? null,
    labels: args.labels,
    assignToMe: args.assignToMe,
  };
  return proposeAction(context, action);
}

type ActionOf<Name extends SparkAction['action']> = Extract<SparkAction, { action: Name }>;

export async function performCreateTicket(
  context: SparkToolContext,
  action: ActionOf<'create_ticket'>,
): Promise<Performed> {
  const created = await createTicket(ticketDepsFor(context.deps, context.scope), action);
  return {
    message: `Created ${created.key}.`,
    url: created.url,
    output: {
      key: created.key,
      ...(created.skippedLabels.length > 0 ? { labelsNotFound: created.skippedLabels } : {}),
    },
  };
}

async function comment(
  context: SparkToolContext,
  args: { source?: TicketSourceId | undefined; key: string; body: string },
) {
  const deps = ticketDepsFor(context.deps, context.scope);
  const source = await pickSource(deps, args.source);
  const { ref } = await ticketOf(deps, source, args.key);
  const action: SparkAction = { action: 'comment_ticket', ticket: ref, body: args.body };
  return proposeAction(context, action);
}

export async function performCommentTicket(
  context: SparkToolContext,
  action: ActionOf<'comment_ticket'>,
): Promise<Performed> {
  const deps = ticketDepsFor(context.deps, context.scope);
  const { ticket } = action;
  const open = await requireSource(deps, ticket.source);
  await open.source.comment(ticket.key, action.body);
  await recordTicketEvent(deps.db, deps.workspaceId, {
    source: ticket.source,
    action: 'comment',
    ticketKey: ticket.key,
    outcome: 'succeeded',
    detail: { length: action.body.length, via: 'spark_tools' },
  });
  return { message: `Commented on ${ticket.key}.`, url: ticket.url, output: { key: ticket.key } };
}

function moveRequest(status: string): MoveRequest {
  const group = ticketStatusSchema.safeParse(status.trim().toLowerCase());
  return group.success ? { group: group.data } : { name: status };
}

async function transition(
  context: SparkToolContext,
  args: { source?: TicketSourceId | undefined; key: string; status: string },
) {
  const deps = ticketDepsFor(context.deps, context.scope);
  const source = await pickSource(deps, args.source);
  const { open, ref } = await ticketOf(deps, source, args.key);
  const plan = await open.source.planMove(ref.key, moveRequest(args.status));
  if (plan.stopped === 'unchanged') {
    return { outcome: 'unchanged', message: `${ref.key} stays at ${plan.from}. ${plan.message}` };
  }
  if (!plan.to || !plan.status) {
    return {
      outcome: 'needs_status',
      message: `${plan.message} Nothing was moved. Call again with status set to one of the exact names in statuses.`,
      statuses: plan.statuses,
    };
  }
  const action: SparkAction = {
    action: 'transition_ticket',
    ticket: ref,
    from: plan.from,
    status: plan.status,
    to: plan.to,
    choices: plan.statuses,
  };
  return proposeAction(context, action);
}

export async function performTransitionTicket(
  context: SparkToolContext,
  action: ActionOf<'transition_ticket'>,
): Promise<Performed> {
  const deps = ticketDepsFor(context.deps, context.scope);
  const { ticket } = action;
  const open = await requireSource(deps, ticket.source);
  const request: MoveRequest = action.to ? { name: action.to } : { group: action.status };
  const sync = await moveTicket(deps, open, ticket.key, request, null, { via: 'spark_tools' });
  if (sync.outcome === 'failed') throw new Error(sync.message ?? 'The move failed.');
  const moved = sync.outcome === 'succeeded';
  return {
    message: sync.message ?? `Moved ${ticket.key}${action.to ? ` to ${action.to}` : ''}.`,
    url: ticket.url,
    output: { key: ticket.key, moved, ...(moved && action.to ? { status: action.to } : {}) },
  };
}

async function assign(
  context: SparkToolContext,
  args: { source?: TicketSourceId | undefined; key: string; to: 'me' | 'nobody' },
) {
  const deps = ticketDepsFor(context.deps, context.scope);
  const source = await pickSource(deps, args.source);
  const { summary, ref } = await ticketOf(deps, source, args.key);
  const action: SparkAction = {
    action: 'assign_ticket',
    ticket: ref,
    currentAssignee: summary.assignedTo?.name ?? null,
    currentAssigneeId: summary.assignedTo?.id ?? null,
    to: args.to,
  };
  return proposeAction(context, action);
}

export async function performAssignTicket(
  context: SparkToolContext,
  action: ActionOf<'assign_ticket'>,
): Promise<Performed> {
  const deps = ticketDepsFor(context.deps, context.scope);
  const { ticket } = action;
  const result = await assignTicket(deps, ticket.source, ticket.key, {
    to: action.to === 'me' ? 'me' : null,
    expectedAssigneeId: action.currentAssigneeId,
    confirmTakeover: true,
  });
  const assignedTo = result.ticket.assignedTo?.name ?? null;
  return {
    message: assignedTo ? `Assigned ${ticket.key} to ${assignedTo}.` : `Unassigned ${ticket.key}.`,
    url: ticket.url,
    output: { key: ticket.key, assignedTo },
  };
}

export const ticketActionTools = [
  sparkTool({
    name: 'spark_create_ticket',
    title: 'Create a ticket',
    acts: true,
    needs: 'tickets',
    description: `Create a Jira or Linear ticket. ${ACTION_NOTE} Returns the new key and URL, or that the user declined.`,
    input: createInput,
    run: (args, context) => create(context, args),
  }),
  sparkTool({
    name: 'spark_comment_ticket',
    title: 'Comment on a ticket',
    acts: true,
    needs: 'tickets',
    description: `Post a comment on a Jira or Linear ticket. ${ACTION_NOTE}`,
    input: {
      source: sourceInput,
      key: keyInput,
      body: z.string().trim().min(1).max(SPARK_TEXT_MAX),
    },
    run: (args, context) => comment(context, args),
  }),
  sparkTool({
    name: 'spark_transition_ticket',
    title: 'Move a ticket',
    acts: true,
    needs: 'tickets',
    description: `Move a Jira or Linear ticket. status is a group (todo, in_progress, in_review, done) or the exact name of one of the project's statuses. A group moves only when the project has one clear status for it; otherwise nothing moves and the result lists the status names to choose from. ${ACTION_NOTE}`,
    input: {
      source: sourceInput,
      key: keyInput,
      status: z.string().trim().min(1).max(100).describe('A group or an exact status name.'),
    },
    run: (args, context) => transition(context, args),
  }),
  sparkTool({
    name: 'spark_assign_ticket',
    title: 'Assign a ticket',
    acts: true,
    needs: 'tickets',
    description: `Assign a Jira or Linear ticket to the user (me) or unassign it (nobody). The card names the current assignee, so taking someone else's ticket is confirmed explicitly. ${ACTION_NOTE}`,
    input: { source: sourceInput, key: keyInput, to: z.enum(['me', 'nobody']) },
    run: (args, context) => assign(context, args),
  }),
];

import { z } from 'zod';
import {
  SPARK_LABELS_MAX,
  SPARK_TEXT_MAX,
  SPARK_TITLE_MAX,
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
import { moveTicket } from '../../tickets/sync.ts';
import { ticketDepsFor } from '../deps.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';
import { confirmThen } from './confirm.ts';

const sourceInput = ticketSourceIdSchema
  .optional()
  .describe('jira or linear. Defaults to the only connected one.');
const keyInput = ticketKeySchema.describe('Ticket key, such as ENG-12.');

async function pickSource(deps: TicketDeps, requested: TicketSourceId | undefined) {
  if (requested) return requested;
  const connected = await connectedSources(deps);
  if (connected.length === 1) return connected[0]!.connection.source;
  if (connected.length === 0) {
    throw new SparkToolError('No ticket source is connected. Connect Jira or Linear in Settings.');
  }
  throw new SparkToolError('Both Jira and Linear are connected; pass source.');
}

async function ticketOf(deps: TicketDeps, source: TicketSourceId, key: string) {
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
  return confirmThen(context, action, async (confirmed) => {
    if (confirmed.action !== 'create_ticket') throw new Error('Unexpected action.');
    const created = await createTicket(deps, confirmed);
    return {
      key: created.key,
      url: created.url,
      ...(created.skippedLabels.length > 0 ? { labelsNotFound: created.skippedLabels } : {}),
    };
  });
}

async function comment(
  context: SparkToolContext,
  args: { source?: TicketSourceId | undefined; key: string; body: string },
) {
  const deps = ticketDepsFor(context.deps, context.scope);
  const source = await pickSource(deps, args.source);
  const { open, ref } = await ticketOf(deps, source, args.key);
  const action: SparkAction = { action: 'comment_ticket', ticket: ref, body: args.body };
  return confirmThen(context, action, async (confirmed) => {
    if (confirmed.action !== 'comment_ticket') throw new Error('Unexpected action.');
    await open.source.comment(ref.key, confirmed.body);
    await recordTicketEvent(deps.db, deps.workspaceId, {
      source,
      action: 'comment',
      ticketKey: ref.key,
      outcome: 'succeeded',
      detail: { length: confirmed.body.length, via: 'spark_tools' },
    });
    return { key: ref.key, url: ref.url };
  });
}

async function transition(
  context: SparkToolContext,
  args: { source?: TicketSourceId | undefined; key: string; status: SparkStatus },
) {
  const deps = ticketDepsFor(context.deps, context.scope);
  const source = await pickSource(deps, args.source);
  const { open, summary, ref } = await ticketOf(deps, source, args.key);
  if (summary.status === args.status) {
    return { outcome: 'unchanged', message: `${ref.key} is already ${summary.statusName}.` };
  }
  const action: SparkAction = {
    action: 'transition_ticket',
    ticket: ref,
    from: summary.statusName,
    status: args.status,
  };
  return confirmThen(context, action, async (confirmed) => {
    if (confirmed.action !== 'transition_ticket') throw new Error('Unexpected action.');
    const sync = await moveTicket(deps, open, ref.key, confirmed.status, null, {
      via: 'spark_tools',
    });
    if (sync.outcome === 'failed') throw new Error(sync.message ?? 'The move failed.');
    return { key: ref.key, moved: sync.outcome === 'succeeded', message: sync.message };
  });
}

type SparkStatus = z.infer<typeof ticketStatusSchema>;

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
  return confirmThen(context, action, async (confirmed) => {
    if (confirmed.action !== 'assign_ticket') throw new Error('Unexpected action.');
    const result = await assignTicket(deps, source, ref.key, {
      to: confirmed.to === 'me' ? 'me' : null,
      expectedAssigneeId: confirmed.currentAssigneeId,
      confirmTakeover: true,
    });
    return { key: ref.key, assignedTo: result.ticket.assignedTo?.name ?? null };
  });
}

const CONFIRM_NOTE = `Spark shows the user a card with exactly what will change; nothing happens until they confirm, and they may edit the fields first. The call waits for their answer.`;

export const ticketActionTools = [
  sparkTool({
    name: 'spark_create_ticket',
    title: 'Create a ticket',
    acts: true,
    description: `Create a Jira or Linear ticket through Spark's connector. ${CONFIRM_NOTE} Returns the new key and URL, or that the user declined.`,
    input: createInput,
    run: (args, context) => create(context, args),
  }),
  sparkTool({
    name: 'spark_comment_ticket',
    title: 'Comment on a ticket',
    acts: true,
    description: `Post a comment on a Jira or Linear ticket. ${CONFIRM_NOTE}`,
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
    description: `Move a Jira or Linear ticket to todo, in_progress, in_review or done (mapped to the project's own statuses). ${CONFIRM_NOTE}`,
    input: { source: sourceInput, key: keyInput, status: ticketStatusSchema },
    run: (args, context) => transition(context, args),
  }),
  sparkTool({
    name: 'spark_assign_ticket',
    title: 'Assign a ticket',
    acts: true,
    description: `Assign a Jira or Linear ticket to the user (me) or unassign it (nobody). The card names the current assignee, so taking someone else's ticket is confirmed explicitly. ${CONFIRM_NOTE}`,
    input: { source: sourceInput, key: keyInput, to: z.enum(['me', 'nobody']) },
    run: (args, context) => assign(context, args),
  }),
];

import { z } from 'zod';
import {
  ticketSectionSchema,
  ticketSourceIdSchema,
  type InboxTicket,
} from '@spark-outpost/contracts';
import { harnessReport, overviewReport, spendReport } from '../../analytics/report.ts';
import { computeDigestStats } from '../../digest/stats.ts';
import { digestState } from '../../digest/service.ts';
import { attentionSnapshot } from '../../persistence/attention-settings.ts';
import { loadActivity } from '../../persistence/digests.ts';
import { loadInbox } from '../../tickets/inbox.ts';
import { inboxDepsFor, nowOf } from '../deps.ts';
import { page } from '../format.ts';
import { limitInput, offsetInput, sparkTool, type SparkToolContext } from '../tool.ts';
import { lastDays } from './window.ts';

const PRIORITY_NAMES = ['none', 'urgent', 'high', 'medium', 'low'];
const urgency = (ticket: InboxTicket) => ticket.priorityRank || PRIORITY_NAMES.length;

function ticketLine(ticket: InboxTicket) {
  return {
    source: ticket.source,
    key: ticket.key,
    title: ticket.title,
    status: ticket.statusName,
    priority: ticket.priority ?? PRIORITY_NAMES[ticket.priorityRank] ?? null,
    section: ticket.section,
    why: ticket.reason,
    ...(ticket.flags.length > 0 ? { flags: ticket.flags.map((flag) => flag.text) } : {}),
    project: ticket.project,
    ...(ticket.dueDate ? { due: ticket.dueDate } : {}),
    ...(ticket.sprint ? { sprint: ticket.sprint } : {}),
    assignedTo: ticket.assignedTo?.name ?? null,
    labels: ticket.labels,
    url: ticket.url,
    ...(ticket.chat ? { chat: ticket.chat } : {}),
    ...(ticket.pullRequest ? { pullRequest: ticket.pullRequest } : {}),
    ...(ticket.snooze ? { snoozedUntil: ticket.snooze.until } : {}),
  };
}

async function tickets(
  context: SparkToolContext,
  args: {
    section?: z.infer<typeof ticketSectionSchema> | undefined;
    source?: z.infer<typeof ticketSourceIdSchema> | undefined;
    sort: 'inbox' | 'priority';
    includeDone: boolean;
    limit: number;
    offset: number;
  },
) {
  const inbox = await loadInbox(inboxDepsFor(context.deps, context.scope));
  const matching = inbox.tickets.filter(
    (ticket) =>
      (!args.section || ticket.section === args.section) &&
      (!args.source || ticket.source === args.source) &&
      (args.includeDone || args.section === 'done' || ticket.section !== 'done'),
  );
  const ordered =
    args.sort === 'priority' ? matching.toSorted((a, b) => urgency(a) - urgency(b)) : matching;
  const shown = page(ordered, args.offset, args.limit);
  return {
    connected: inbox.sources,
    ...(inbox.sources.length === 0
      ? { note: 'No ticket source is connected. Connect Jira or Linear in Settings → Tickets.' }
      : {}),
    problems: inbox.errors,
    syncedAt: inbox.syncedAt,
    ...shown,
    items: shown.items.map(ticketLine),
  };
}

const REPORTS = ['overview', 'spend', 'harness'] as const;

async function analytics(
  { deps, scope }: SparkToolContext,
  report: (typeof REPORTS)[number],
  days: number,
) {
  const window = lastDays(deps, days);
  if (report === 'overview') {
    const { days: daily, ...rest } = await overviewReport(deps.db, scope.workspaceId, window);
    return { ...rest, busiestDays: daily.filter((day) => day.turns > 0 || day.runs > 0) };
  }
  if (report === 'spend') {
    const { days: daily, ...rest } = await spendReport(deps.db, scope.workspaceId, window);
    return {
      ...rest,
      daysWithSpend: daily.filter((day) => day.reportedUsd + day.estimatedUsd > 0),
    };
  }
  const { confidence, ...rest } = await harnessReport(deps.db, scope.workspaceId, window);
  return { ...rest, confidencePoints: confidence.length };
}

async function activity({ deps, scope }: SparkToolContext, hours: number, limit: number) {
  const since = new Date(nowOf(deps).getTime() - hours * 3_600_000);
  const chats = await loadActivity(deps.db, scope.workspaceId, since);
  return {
    since: since.toISOString(),
    stats: computeDigestStats(chats),
    chats: chats.slice(0, limit),
    ...(chats.length > limit ? { moreChats: chats.length - limit } : {}),
  };
}

async function brief({ deps, scope }: SparkToolContext) {
  const [state, flagged] = await Promise.all([
    digestState(deps.db, scope.workspaceId, nowOf(deps)),
    attentionSnapshot(deps.db, scope.workspaceId),
  ]);
  const digest = state.digest;
  return {
    available: state.available,
    newActivitySinceBrief: state.newActivity,
    canRefreshAt: state.refreshableAt,
    brief: digest
      ? {
          status: digest.status,
          writtenAt: digest.finishedAt ?? digest.createdAt,
          covers: digest.since,
          body: digest.body,
          stats: digest.stats,
          error: digest.error,
          by: [digest.provider, digest.modelLabel].filter(Boolean).join(' · '),
          costUsd: digest.costUsd,
        }
      : null,
    flaggedTickets: flagged.items,
  };
}

export const workTools = [
  sparkTool({
    name: 'spark_tickets',
    title: 'Tickets',
    description:
      "The user's Jira and Linear tickets as Spark's Tickets inbox sorts them: needs attention first (overdue, stale, blocked, urgent not started), then working, PR ready, in review, up next. sort=priority puts urgent and high first. Each ticket has its status, priority, why it is flagged, due date, linked chat and PR. Fetches fresh data from the connected sources.",
    input: {
      section: ticketSectionSchema.optional().describe('Only one inbox section.'),
      source: ticketSourceIdSchema.optional(),
      sort: z.enum(['inbox', 'priority']).default('inbox'),
      includeDone: z.boolean().default(false),
      limit: limitInput(15, 50),
      offset: offsetInput,
    },
    run: (args, context) => tickets(context, args),
  }),
  sparkTool({
    name: 'spark_analytics',
    title: 'Analytics',
    description:
      'Spark analytics for the last N days. overview: turns, runs, cost, outcomes (good, bad, mixed), keep and revert rates, checks and a health score. spend: reported and estimated cost, cost per task and per good outcome, Jev spend, top cost drivers. harness: flow paths, Jev and rule agreement, Critic, checks, loops, approval waits and routing cost.',
    input: {
      report: z.enum(REPORTS).default('overview'),
      days: z.number().int().min(1).max(90).default(7),
    },
    run: (args, context) => analytics(context, args.report, args.days),
  }),
  sparkTool({
    name: 'spark_activity',
    title: 'Recent activity',
    description:
      'Chats active in the last N hours with their state (waiting, running, failed, stalled, finished), what they wait on, errors, plan progress, files changed, checks, last reply and cost, plus totals.',
    input: {
      hours: z
        .number()
        .int()
        .min(1)
        .max(24 * 14)
        .default(24),
      limit: limitInput(20, 50),
    },
    run: (args, context) => activity(context, args.hours, args.limit),
  }),
  sparkTool({
    name: 'spark_brief',
    title: 'Morning brief',
    description:
      "The latest Spark brief (the morning digest of chats and tickets): when it was written, what it said, whether there is newer activity, and the tickets currently flagged for attention. Read only; it doesn't write a new brief.",
    input: {},
    run: (_args, context) => brief(context),
  }),
];

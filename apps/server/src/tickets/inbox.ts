import {
  ticketChatState,
  ticketItemId,
  type InboxTicket,
  type PullRequestStatus,
  type TicketInbox,
  type TicketListItem,
  type TicketSourceProblem,
  type TicketSummary,
} from '@spark-outpost/contracts';
import { getAttentionSettings, saveAttentionSnapshot } from '../persistence/attention-settings.ts';
import type { FlaggedItem } from '../persistence/attention-settings.ts';
import { listConversations } from '../persistence/conversations.ts';
import { prFeedbackWaiting } from '../persistence/pr-watches.ts';
import { lastTicketSyncs, mergeMoveTried } from '../persistence/ticket-events.ts';
import {
  cacheTickets,
  setDismissedFlags,
  ticketRef,
  ticketTimes,
  ticketWork,
} from '../persistence/tickets.ts';
import { settledDismissals, type Thresholds, type TicketFacts } from './attention.ts';
import { connectedSources, type OpenSource } from './connections.ts';
import { inboxDevelopment, type DevelopmentDeps } from './development.ts';
import { placeTicket, sortInbox } from './sections.ts';
import { TicketApiError } from './source.ts';
import { moveTicket } from './sync.ts';

export const DONE_RECENTLY_DAYS = 7;

export type InboxDeps = DevelopmentDeps;

export function problemOf(source: OpenSource, error: unknown): TicketSourceProblem {
  const status = error instanceof TicketApiError ? error.status : -1;
  return {
    source: source.connection.source,
    message: (error as Error).message,
    kind: status === 401 ? 'auth' : status === 0 ? 'unreachable' : 'other',
  };
}

async function fetchMine(open: OpenSource) {
  try {
    const [active, done] = await Promise.all([
      open.source.listAssigned({}),
      open.source.listAssigned({ status: 'done', doneWithinDays: DONE_RECENTLY_DAYS }),
    ]);
    return { tickets: [...active, ...done], problem: null };
  } catch (error) {
    return { tickets: [], problem: problemOf(open, error) };
  }
}

const latestPull = (ticket: TicketListItem) =>
  ticket.work.flatMap((work) => work.pullRequests).at(-1)?.url ?? null;

async function closeMerged(
  deps: InboxDeps,
  sources: readonly OpenSource[],
  ticket: TicketSummary,
  pull: PullRequestStatus,
  taskId: string | null,
): Promise<TicketSummary> {
  const open = sources.find((entry) => entry.connection.source === ticket.source);
  if (!open?.connection.moveOnMerge || ticket.status === 'done') return ticket;
  if (await mergeMoveTried(deps.db, deps.workspaceId, ticket, pull.url)) return ticket;
  const sync = await moveTicket(deps, open, ticket.key, { group: 'done' }, taskId, {
    mergedPullRequest: pull.url,
  });
  if (sync.outcome !== 'succeeded') return ticket;
  return open.source.getSummary(ticket.key).catch(() => ({ ...ticket, status: 'done' as const }));
}

const DAY_MS = 24 * 3_600_000;

function flaggedItem(ticket: InboxTicket, now: Date): FlaggedItem {
  const pull = ticket.pullRequest;
  return {
    itemId: ticketItemId(ticket.source, ticket.key),
    key: ticket.key,
    title: ticket.title,
    source: ticket.source,
    status: ticket.statusName,
    priority: ticket.priority,
    dueDate: ticket.dueDate,
    project: ticket.project,
    pullRequest: pull ? { repo: pull.repo, number: pull.number, state: pull.state } : null,
    flags: ticket.flags.map((flag) => ({
      rule: flag.rule,
      text: flag.text,
      days: flag.since ? Math.floor((now.getTime() - Date.parse(flag.since)) / DAY_MS) : null,
    })),
  };
}

async function factsFor(
  deps: InboxDeps,
  sources: readonly OpenSource[],
  summaries: readonly TicketSummary[],
): Promise<TicketFacts[]> {
  const refs = summaries.map((ticket) => ticketRef(ticket.source, ticket.key));
  const [work, times, syncs, chats] = await Promise.all([
    ticketWork(deps.db, deps.workspaceId, summaries),
    ticketTimes(deps.db, deps.workspaceId, summaries),
    lastTicketSyncs(deps.db, deps.workspaceId, refs),
    listConversations(deps.db, deps.workspaceId),
  ]);
  const chatById = new Map(chats.map((chat) => [chat.id, chat] as const));
  const listed = summaries.map((ticket): TicketListItem => ({
    ...ticket,
    work: work.get(ticketRef(ticket.source, ticket.key)) ?? [],
  }));
  const pullUrls = listed.flatMap((t) => latestPull(t) ?? []);
  const developmentOf = await inboxDevelopment(deps, sources, listed);
  const feedback = await prFeedbackWaiting(deps.db, deps.workspaceId, pullUrls);
  return Promise.all(
    listed.map(async (item): Promise<TicketFacts> => {
      const ref = ticketRef(item.source, item.key);
      const pullUrl = latestPull(item);
      const { pull, mine, development } = developmentOf(item);
      const lastWork = item.work.at(-1) ?? null;
      const ticket =
        pull?.state === 'merged'
          ? {
              ...(await closeMerged(deps, sources, item, pull, lastWork?.taskId ?? null)),
              work: item.work,
            }
          : item;
      const chat = lastWork ? chatById.get(lastWork.conversationId) : undefined;
      return {
        ticket,
        chat: chat
          ? {
              conversationId: chat.id,
              title: chat.title,
              state: ticketChatState(chat),
              at: chat.updatedAt,
              progress: chat.latestRun?.progress ?? null,
              agent: chat.teammate?.name ?? null,
            }
          : null,
        pullRequest: pull,
        pullRequestMine: mine,
        development,
        lastSync: syncs.get(ref) ?? null,
        statusSince: times.get(ref)?.statusSince?.toISOString() ?? null,
        assignedSince: times.get(ref)?.firstSeenAssignedAt?.toISOString() ?? null,
        snooze: times.get(ref)?.snooze ?? null,
        prFeedback: pullUrl ? (feedback.get(pullUrl) ?? null) : null,
        dismissed: times.get(ref)?.dismissed ?? [],
        noticeSeen: times.get(ref)?.noticeSeen ?? null,
      };
    }),
  );
}

async function forgetSettledDismissals(
  deps: InboxDeps,
  facts: readonly TicketFacts[],
  limits: Thresholds,
  now: Date,
): Promise<TicketFacts[]> {
  return Promise.all(
    facts.map(async (fact) => {
      const settled = settledDismissals(fact, limits, now);
      if (settled.length === 0) return fact;
      const dismissed = (fact.dismissed ?? []).filter((key) => !settled.includes(key));
      await setDismissedFlags(deps.db, deps.workspaceId, fact.ticket, dismissed);
      return { ...fact, dismissed };
    }),
  );
}

export async function loadInbox(deps: InboxDeps): Promise<TicketInbox> {
  const now = deps.now?.() ?? new Date();
  const settings = await getAttentionSettings(deps.db, deps.workspaceId);
  const sources = await connectedSources(deps);
  const fetched = await Promise.all(sources.map(fetchMine));
  const summaries = fetched.flatMap((result) => result.tickets);
  await cacheTickets(deps.db, deps.workspaceId, summaries, { assignedToMe: true });
  const facts = await forgetSettledDismissals(
    deps,
    await factsFor(deps, sources, summaries),
    settings,
    now,
  );
  const tickets = sortInbox(facts.map((fact) => placeTicket(fact, settings, now)));
  const flagged = tickets
    .filter((ticket) => ticket.section === 'attention')
    .map((ticket) => flaggedItem(ticket, now));
  await saveAttentionSnapshot(deps.db, deps.workspaceId, flagged);
  return {
    tickets,
    errors: fetched.flatMap((result) => (result.problem ? [result.problem] : [])),
    sources: sources.map((open) => open.connection.source),
    syncedAt: now.toISOString(),
    settings,
  };
}

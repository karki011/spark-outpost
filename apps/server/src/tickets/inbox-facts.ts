import {
  ticketChatState,
  type PullRequestStatus,
  type TicketListItem,
  type TicketSummary,
} from '@spark-outpost/contracts';
import { listConversations } from '../persistence/conversations.ts';
import { prFeedbackWaiting } from '../persistence/pr-watches.ts';
import {
  lastTicketSyncs,
  mergeMoveTried,
  whileClaimingMergeMove,
} from '../persistence/ticket-events.ts';
import { ticketRef, ticketTimes, ticketWork } from '../persistence/tickets.ts';
import type { TicketFacts } from './attention.ts';
import type { OpenSource } from './connections.ts';
import { inboxDevelopment, type DevelopmentDeps } from './development.ts';
import { moveTicket } from './sync.ts';

const latestPull = (ticket: TicketListItem) =>
  ticket.work.flatMap((work) => work.pullRequests).at(-1)?.url ?? null;

let closing: Promise<unknown> = Promise.resolve();

function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const turn = closing.then(work, work);
  closing = turn.catch(() => undefined);
  return turn;
}

async function closeMerged(
  deps: DevelopmentDeps,
  sources: readonly OpenSource[],
  ticket: TicketSummary,
  pull: PullRequestStatus,
  taskId: string | null,
): Promise<TicketSummary> {
  const open = sources.find((entry) => entry.connection.source === ticket.source);
  if (!open?.connection.moveOnMerge || ticket.status === 'done') return ticket;
  if (await mergeMoveTried(deps.db, deps.workspaceId, ticket, pull.url)) return ticket;
  const sync = await oneAtATime(() =>
    whileClaimingMergeMove(deps.db, deps.workspaceId, ticket, pull.url, () =>
      moveTicket(deps, open, ticket.key, { group: 'done' }, taskId, {
        mergedPullRequest: pull.url,
      }),
    ),
  );
  if (sync?.outcome !== 'succeeded') return ticket;
  return open.source.getSummary(ticket.key).catch(() => ({ ...ticket, status: 'done' as const }));
}

type LocalFields = Pick<
  TicketFacts,
  | 'chat'
  | 'lastSync'
  | 'statusSince'
  | 'assignedSince'
  | 'snooze'
  | 'prFeedback'
  | 'dismissed'
  | 'noticeSeen'
>;

async function readLocal(deps: DevelopmentDeps, summaries: readonly TicketSummary[]) {
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
  const feedback = await prFeedbackWaiting(
    deps.db,
    deps.workspaceId,
    listed.flatMap((item) => latestPull(item) ?? []),
  );
  const fields = (item: TicketListItem): LocalFields => {
    const ref = ticketRef(item.source, item.key);
    const pullUrl = latestPull(item);
    const lastWork = item.work.at(-1) ?? null;
    const chat = lastWork ? chatById.get(lastWork.conversationId) : undefined;
    return {
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
      lastSync: syncs.get(ref) ?? null,
      statusSince: times.get(ref)?.statusSince?.toISOString() ?? null,
      assignedSince: times.get(ref)?.firstSeenAssignedAt?.toISOString() ?? null,
      snooze: times.get(ref)?.snooze ?? null,
      prFeedback: pullUrl ? (feedback.get(pullUrl) ?? null) : null,
      dismissed: times.get(ref)?.dismissed ?? [],
      noticeSeen: times.get(ref)?.noticeSeen ?? null,
    };
  };
  return { listed, fields };
}

export async function factsFor(
  deps: DevelopmentDeps,
  sources: readonly OpenSource[],
  summaries: readonly TicketSummary[],
): Promise<TicketFacts[]> {
  const { listed, fields } = await readLocal(deps, summaries);
  const developmentOf = await inboxDevelopment(deps, sources, listed);
  return Promise.all(
    listed.map(async (item): Promise<TicketFacts> => {
      const { pull, mine, development } = developmentOf(item);
      const lastWork = item.work.at(-1) ?? null;
      const ticket =
        pull?.state === 'merged'
          ? {
              ...(await closeMerged(deps, sources, item, pull, lastWork?.taskId ?? null)),
              work: item.work,
            }
          : item;
      return { ticket, pullRequest: pull, pullRequestMine: mine, development, ...fields(item) };
    }),
  );
}

const sparkPulls = (ticket: TicketListItem) =>
  ticket.work.flatMap((work) => work.pullRequests.map((pull) => pull.url)).join('\n');

export async function refreshLocalFacts(
  deps: DevelopmentDeps,
  facts: readonly TicketFacts[],
): Promise<{ facts: TicketFacts[]; pullsChanged: boolean }> {
  const { listed, fields } = await readLocal(
    deps,
    facts.map((fact) => fact.ticket),
  );
  return {
    facts: facts.map((fact, index): TicketFacts => {
      const item = listed[index]!;
      return { ...fact, ticket: { ...fact.ticket, work: item.work }, ...fields(item) };
    }),
    pullsChanged: facts.some(
      (fact, index) => sparkPulls(fact.ticket) !== sparkPulls(listed[index]!),
    ),
  };
}

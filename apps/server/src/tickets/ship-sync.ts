import {
  ticketSourceNames,
  type PrOpenedVia,
  type PrTicketSync,
  type TicketRef,
} from '@spark-outpost/contracts';
import {
  claimTicketSync,
  saveTicketSync,
  type KnownTicket,
} from '../persistence/pull-ticket-sync.ts';
import { recordTicketEvent } from '../persistence/ticket-events.ts';
import { ticketsForTask } from '../persistence/tickets.ts';
import {
  findTrackedPull,
  type PullAddress,
  type TrackedPull,
} from '../persistence/tracked-pulls.ts';
import { connectedSources, type OpenSource, type TicketDeps } from './connections.ts';
import { sameTicket, ticketsNamedIn } from './pull-ticket-keys.ts';
import { linkPullRequest, moveTicket } from './sync.ts';

export type ShipTicketDeps = Omit<TicketDeps, 'linearApiUrl'>;

const SYNCED_VIA: ReadonlySet<PrOpenedVia> = new Set(['ship', 'agent']);

export function syncsTickets(pull: TrackedPull): boolean {
  return (
    pull.ticketSyncClaimedAt === null &&
    SYNCED_VIA.has(pull.openedVia) &&
    !pull.outside &&
    pull.prState === 'open'
  );
}

async function notConnected(
  deps: ShipTicketDeps,
  ticket: KnownTicket,
  pull: TicketRef,
  taskId: string | null,
): Promise<PrTicketSync> {
  await recordTicketEvent(deps.db, deps.workspaceId, {
    source: ticket.source,
    action: 'link_pr',
    ticketKey: ticket.key,
    taskId,
    outcome: 'skipped',
    detail: { url: pull.url, message: 'Not connected.' },
  });
  return {
    ...ticket,
    outcome: 'skipped',
    message: `${ticketSourceNames[ticket.source]} isn't connected.`,
  };
}

async function syncTicket(
  deps: ShipTicketDeps,
  open: OpenSource | undefined,
  ticket: KnownTicket,
  pull: TicketRef,
  taskId: string | null,
): Promise<PrTicketSync | null> {
  if (!open) return notConnected(deps, ticket, pull, taskId);
  await linkPullRequest(deps, open, ticket.key, pull, taskId);
  if (!open.connection.moveOnShip) return null;
  const sync = await moveTicket(deps, open, ticket.key, { group: 'in_review' }, taskId, {
    pullRequest: pull.url,
  });
  return { ...ticket, ...sync };
}

const failedSync = (ticket: KnownTicket, error: unknown): PrTicketSync => ({
  ...ticket,
  outcome: 'failed',
  message: error instanceof Error ? error.message : String(error),
});

async function chatTickets(
  deps: ShipTicketDeps,
  pull: TrackedPull,
  sources: readonly OpenSource[],
): Promise<KnownTicket[]> {
  const started = pull.taskId ? await ticketsForTask(deps.db, pull.taskId) : [];
  const named = await ticketsNamedIn(deps.db, deps.workspaceId, sources, [pull.branch, pull.title]);
  const tickets: KnownTicket[] = started.map(({ source, key }) => ({ source, key }));
  for (const ticket of named) {
    if (!tickets.some((known) => sameTicket(known, ticket))) tickets.push(ticket);
  }
  return tickets;
}

export async function syncPullTickets(
  deps: ShipTicketDeps,
  pull: TrackedPull,
): Promise<PrTicketSync[] | null> {
  if (!syncsTickets(pull) || !(await claimTicketSync(deps.db, pull.id))) return null;
  const sources = await connectedSources(deps).catch(() => []);
  const tickets = await chatTickets(deps, pull, sources);
  const ref: TicketRef = { url: pull.url, title: `${pull.owner}/${pull.repo}#${pull.number}` };
  const entries: PrTicketSync[] = [];
  for (const ticket of tickets) {
    const open = sources.find((entry) => entry.connection.source === ticket.source);
    const entry = await syncTicket(deps, open, ticket, ref, pull.taskId).catch((error: unknown) =>
      failedSync(ticket, error),
    );
    if (entry) entries.push(entry);
  }
  await saveTicketSync(deps.db, pull.id, entries);
  return entries;
}

export async function syncRecordedPull(deps: ShipTicketDeps, address: PullAddress): Promise<void> {
  try {
    const pull = await findTrackedPull(deps.db, deps.workspaceId, address);
    if (pull) await syncPullTickets(deps, pull);
  } catch (error) {
    console.error(`Ticket sync for pull request #${address.number} failed`, error);
  }
}

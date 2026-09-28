import type { TicketRef } from '@spark-outpost/contracts';
import { recordTicketEvent } from '../persistence/ticket-events.ts';
import { ticketsForTask } from '../persistence/tickets.ts';
import { openSource, type TicketDeps } from './connections.ts';
import { linkPullRequest, moveTicket } from './sync.ts';

export type ShipTicketDeps = Omit<TicketDeps, 'linearApiUrl'>;

async function syncTicket(
  deps: ShipTicketDeps,
  taskId: string,
  ticket: Awaited<ReturnType<typeof ticketsForTask>>[number],
  pull: TicketRef,
) {
  const open = await openSource(deps, ticket.source);
  if (!open) {
    await recordTicketEvent(deps.db, deps.workspaceId, {
      source: ticket.source,
      action: 'link_pr',
      ticketKey: ticket.key,
      taskId,
      outcome: 'skipped',
      detail: { url: pull.url, message: 'Not connected.' },
    });
    return;
  }
  await linkPullRequest(deps, open, ticket.key, pull, taskId);
  if (open.connection.moveOnShip) {
    await moveTicket(deps, open, ticket.key, 'in_review', taskId);
  }
}

export async function syncTicketsAfterShip(
  deps: ShipTicketDeps,
  taskId: string,
  pull: TicketRef,
): Promise<void> {
  const tickets = await ticketsForTask(deps.db, taskId).catch(() => []);
  for (const ticket of tickets) {
    await syncTicket(deps, taskId, ticket, pull).catch((error: unknown) => {
      console.error(`Ticket sync for ${ticket.key} failed`, error);
    });
  }
}

import type {
  TicketList,
  TicketListQuery,
  TicketSourceId,
  TicketView,
} from '@spark-outpost/contracts';
import { cacheTickets, ticketRef, ticketWork } from '../persistence/tickets.ts';
import { connectedSources, requireSource, type TicketDeps } from './connections.ts';
import { summaryOf } from './source.ts';

export async function listTickets(deps: TicketDeps, query: TicketListQuery): Promise<TicketList> {
  const sources = (await connectedSources(deps)).filter(
    (open) => !query.source || open.connection.source === query.source,
  );
  const results = await Promise.all(
    sources.map(async (open) => {
      try {
        return { tickets: await open.source.listAssigned(query), error: null };
      } catch (error) {
        return {
          tickets: [],
          error: { source: open.connection.source, message: (error as Error).message },
        };
      }
    }),
  );
  const tickets = results
    .flatMap((result) => result.tickets)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  await cacheTickets(deps.db, deps.workspaceId, tickets);
  const work = await ticketWork(deps.db, deps.workspaceId, tickets);
  return {
    tickets: tickets.map((ticket) => ({
      ...ticket,
      work: work.get(ticketRef(ticket.source, ticket.key)) ?? [],
    })),
    errors: results.flatMap((result) => (result.error ? [result.error] : [])),
  };
}

export async function ticketView(
  deps: TicketDeps,
  source: TicketSourceId,
  key: string,
): Promise<TicketView> {
  const open = await requireSource(deps, source);
  const ticket = await open.source.getTicket(key);
  await cacheTickets(deps.db, deps.workspaceId, [summaryOf(ticket)]);
  const work = await ticketWork(deps.db, deps.workspaceId, [ticket]);
  return { ticket, work: work.get(ticketRef(ticket.source, ticket.key)) ?? [] };
}

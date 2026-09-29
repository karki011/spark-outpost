import type { TicketSearch, TicketSearchQuery } from '@spark-outpost/contracts';
import { accountIdOf, connectedSources, type TicketDeps } from './connections.ts';
import { problemOf } from './inbox.ts';

export async function searchTickets(
  deps: TicketDeps,
  query: TicketSearchQuery,
): Promise<TicketSearch> {
  const sources = (await connectedSources(deps)).filter(
    (open) => !query.source || open.connection.source === query.source,
  );
  const results = await Promise.all(
    sources.map(async (open) => {
      try {
        const [me, found] = await Promise.all([
          accountIdOf(deps, open),
          open.source.search({
            q: query.q,
            status: query.status,
            project: query.project,
            assignee: query.assignee,
          }),
        ]);
        return {
          tickets: found.map((ticket) => ({ ...ticket, mine: ticket.assignedTo?.id === me })),
          problem: null,
        };
      } catch (error) {
        return { tickets: [], problem: problemOf(open, error) };
      }
    }),
  );
  return {
    tickets: results
      .flatMap((result) => result.tickets)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    errors: results.flatMap((result) => (result.problem ? [result.problem] : [])),
  };
}

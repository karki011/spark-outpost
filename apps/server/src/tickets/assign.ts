import type { z } from 'zod';
import {
  ticketSourceNames,
  type AssignTicketResponse,
  type assignTicketRequestSchema,
  type TicketPerson,
  type TicketSourceId,
} from '@spark-outpost/contracts';
import { recordTicketEvent } from '../persistence/ticket-events.ts';
import { cacheTickets } from '../persistence/tickets.ts';
import { accountIdOf, requireSource, type TicketDeps } from './connections.ts';
import { TicketApiError, TicketConflictError } from './source.ts';

type AssignRequest = z.infer<typeof assignTicketRequestSchema>;

const describe = (person: TicketPerson | null) =>
  person ? `assigned to ${person.name}` : 'unassigned';

function deniedMessage(source: TicketSourceId, project: string | null): string {
  const where = project ? ` in ${project}` : '';
  return `${ticketSourceNames[source]} says you can't assign issues${where}. Ask a project admin for the Assign issues permission. Nothing changed.`;
}

export async function assignTicket(
  deps: TicketDeps,
  source: TicketSourceId,
  key: string,
  request: AssignRequest,
): Promise<AssignTicketResponse> {
  const open = await requireSource(deps, source);
  const me = await accountIdOf(deps, open);
  const current = await open.source.getSummary(key);
  const previous = current.assignedTo;
  const name = ticketSourceNames[source];
  if (
    request.expectedAssigneeId !== undefined &&
    (previous?.id ?? null) !== request.expectedAssigneeId
  ) {
    throw new TicketConflictError(
      `${key} changed in ${name}: it's now ${describe(previous)}. Refresh and try again.`,
    );
  }
  const target = request.to === 'me' ? me : (request.to?.id ?? null);
  if (previous?.id === target || (previous === null && target === null)) {
    return { ticket: current, previous };
  }
  if (previous && previous.id !== me && !request.confirmTakeover) {
    throw new TicketConflictError(
      `${key} is assigned to ${previous.name}. Confirm that you want to take it over.`,
    );
  }
  try {
    await open.source.assign(key, target);
  } catch (error) {
    await recordTicketEvent(deps.db, deps.workspaceId, {
      source,
      action: 'assign',
      ticketKey: key,
      outcome: 'failed',
      detail: { to: target, message: (error as Error).message },
    });
    if (error instanceof TicketApiError && error.status === 403) {
      throw new TicketConflictError(deniedMessage(source, current.project));
    }
    throw error;
  }
  await recordTicketEvent(deps.db, deps.workspaceId, {
    source,
    action: 'assign',
    ticketKey: key,
    outcome: 'succeeded',
    detail: { from: previous?.id ?? null, to: target, message: null },
  });
  const ticket = await open.source.getSummary(key).catch(() => current);
  await cacheTickets(deps.db, deps.workspaceId, [ticket], { assignedToMe: target === me });
  return { ticket, previous };
}

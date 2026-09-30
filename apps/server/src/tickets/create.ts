import type { TicketPriorityName, TicketSourceId } from '@spark-outpost/contracts';
import { recordTicketEvent } from '../persistence/ticket-events.ts';
import { accountIdOf, requireSource, type TicketDeps } from './connections.ts';
import type { CreatedTicket } from './source.ts';

export interface CreateTicketRequest {
  source: TicketSourceId;
  project: string;
  title: string;
  description: string;
  type: string | null;
  priority: TicketPriorityName | null;
  labels: readonly string[];
  assignToMe: boolean;
}

export async function createTicket(
  deps: TicketDeps,
  request: CreateTicketRequest,
): Promise<CreatedTicket> {
  const open = await requireSource(deps, request.source);
  const assigneeId = request.assignToMe ? await accountIdOf(deps, open) : null;
  const detail = { project: request.project, title: request.title, assigneeId };
  let created: CreatedTicket;
  try {
    created = await open.source.create({ ...request, assigneeId });
  } catch (error) {
    await recordTicketEvent(deps.db, deps.workspaceId, {
      source: request.source,
      action: 'create',
      outcome: 'failed',
      detail: { ...detail, message: (error as Error).message },
    });
    throw error;
  }
  await recordTicketEvent(deps.db, deps.workspaceId, {
    source: request.source,
    action: 'create',
    ticketKey: created.key,
    outcome: 'succeeded',
    detail: { ...detail, skippedLabels: created.skippedLabels },
  });
  return created;
}

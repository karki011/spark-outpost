import type { TicketRef, TicketStatus, TicketSync } from '@spark-outpost/contracts';
import { recordTicketEvent } from '../persistence/ticket-events.ts';
import { setCachedStatus } from '../persistence/tickets.ts';
import type { OpenSource, TicketDeps } from './connections.ts';

type SyncDeps = Pick<TicketDeps, 'db' | 'workspaceId'>;

const failed = (error: unknown): TicketSync => ({
  outcome: 'failed',
  message: (error as Error).message,
});

export async function moveTicket(
  deps: SyncDeps,
  open: OpenSource,
  key: string,
  target: TicketStatus,
  taskId: string | null,
): Promise<TicketSync> {
  let sync: TicketSync;
  try {
    const result = await open.source.transition(key, target);
    sync = result.moved
      ? { outcome: 'succeeded', message: null }
      : { outcome: 'skipped', message: result.message };
    if (result.moved) {
      await setCachedStatus(deps.db, deps.workspaceId, {
        source: open.connection.source,
        key,
        status: target,
        statusName: result.statusName,
      });
    }
  } catch (error) {
    sync = failed(error);
  }
  await recordTicketEvent(deps.db, deps.workspaceId, {
    source: open.connection.source,
    action: 'transition',
    ticketKey: key,
    taskId,
    outcome: sync.outcome,
    detail: { target, message: sync.message },
  });
  return sync;
}

export async function linkPullRequest(
  deps: SyncDeps,
  open: OpenSource,
  key: string,
  pull: TicketRef,
  taskId: string,
): Promise<TicketSync> {
  let sync: TicketSync = { outcome: 'succeeded', message: null };
  try {
    await open.source.linkPullRequest(key, pull);
  } catch (error) {
    sync = failed(error);
  }
  await recordTicketEvent(deps.db, deps.workspaceId, {
    source: open.connection.source,
    action: 'link_pr',
    ticketKey: key,
    taskId,
    outcome: sync.outcome,
    detail: { url: pull.url, message: sync.message },
  });
  return sync;
}

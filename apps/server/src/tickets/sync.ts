import type { TicketRef, TicketSync } from '@spark-outpost/contracts';
import { recordTicketEvent } from '../persistence/ticket-events.ts';
import { setCachedStatus } from '../persistence/tickets.ts';
import type { OpenSource, TicketDeps } from './connections.ts';
import type { MoveRequest } from './move-target.ts';
import type { TransitionResult } from './source.ts';

type SyncDeps = Pick<TicketDeps, 'db' | 'workspaceId'>;

const failed = (error: unknown): TicketSync => ({
  outcome: 'failed',
  message: (error as Error).message,
});

function syncOf(result: TransitionResult): TicketSync {
  if (result.moved) return { outcome: 'succeeded', message: null };
  const failed = result.stopped === 'blocked' || result.stopped === 'refused';
  return { outcome: failed ? 'failed' : 'skipped', message: result.message };
}

export async function moveTicket(
  deps: SyncDeps,
  open: OpenSource,
  key: string,
  request: MoveRequest,
  taskId: string | null,
  detail: Record<string, unknown> = {},
): Promise<TicketSync> {
  let sync: TicketSync;
  let move: Record<string, unknown> = {};
  try {
    const result = await open.source.transition(key, request);
    sync = syncOf(result);
    move = { from: result.from, to: result.to, rule: result.rule ?? result.stopped };
    if (result.moved && result.to && result.status) {
      await setCachedStatus(deps.db, deps.workspaceId, {
        source: open.connection.source,
        key,
        status: result.status,
        statusName: result.to,
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
    detail: {
      ...detail,
      target: 'group' in request ? request.group : request.name,
      ...move,
      message: sync.message,
    },
  });
  return sync;
}

export async function linkPullRequest(
  deps: SyncDeps,
  open: OpenSource,
  key: string,
  pull: TicketRef,
  taskId: string | null,
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

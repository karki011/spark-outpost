import type { PrOpenedVia, PrTicketSync } from '@spark-outpost/contracts';
import type { Db } from '../src/persistence/db.ts';
import { trackPull, type TrackedPull } from '../src/persistence/tracked-pulls.ts';
import { pullAddress } from '../src/pr-tracking/track.ts';
import { syncPullTickets, type ShipTicketDeps } from '../src/tickets/ship-sync.ts';

export interface ShippedPull {
  url: string;
  branch?: string;
  title?: string | null;
  via?: PrOpenedVia;
  conversationId?: string;
}

async function conversationOf(db: Db, taskId: string): Promise<string> {
  const { rows } = await db.query<{ conversation_id: string }>(
    'SELECT conversation_id FROM tasks WHERE id = $1',
    [taskId],
  );
  return rows[0]!.conversation_id;
}

export async function trackShipped(
  deps: ShipTicketDeps,
  taskId: string | null,
  shipped: ShippedPull,
): Promise<TrackedPull> {
  const conversationId = shipped.conversationId ?? (await conversationOf(deps.db, taskId!));
  const tracked = await trackPull(deps.db, {
    ...pullAddress(shipped.url)!,
    workspaceId: deps.workspaceId,
    conversationId,
    taskId,
    url: shipped.url,
    branch: shipped.branch ?? 'spark/fix-the-thing',
    via: shipped.via ?? 'ship',
    by: null,
    runId: null,
    outside: false,
    followUp: taskId !== null,
    title: shipped.title ?? null,
  });
  return tracked!.pull;
}

export async function syncShipped(
  deps: ShipTicketDeps,
  taskId: string | null,
  shipped: ShippedPull,
): Promise<PrTicketSync[] | null> {
  return syncPullTickets(deps, await trackShipped(deps, taskId, shipped));
}

import {
  SNOOZE_MAX_DAYS,
  type SnoozeTicketRequest,
  type TicketSourceId,
} from '@spark-outpost/contracts';
import { setDismissedFlags, setNoticeSeen, setTicketSnooze } from '../persistence/tickets.ts';
import type { TicketDeps } from './connections.ts';
import { TicketApiError } from './source.ts';

const DAY_MS = 24 * 3_600_000;

export function snoozeProblem(until: Date, now: Date): string | null {
  if (until.getTime() <= now.getTime()) return 'Pick a time in the future.';
  if (until.getTime() - now.getTime() > SNOOZE_MAX_DAYS * DAY_MS) {
    return `Snooze for ${SNOOZE_MAX_DAYS} days or less.`;
  }
  return null;
}

type TicketId = { source: TicketSourceId; key: string };

function requireFound(found: boolean, ticket: TicketId): void {
  if (found) return;
  throw new TicketApiError(404, `${ticket.key} isn't in your ticket inbox. Refresh and try again.`);
}

export async function snoozeTicket(
  deps: TicketDeps,
  ticket: TicketId,
  request: SnoozeTicketRequest | null,
): Promise<void> {
  const snooze = request
    ? { until: new Date(request.until), rules: [...new Set(request.rules)] }
    : null;
  requireFound(await setTicketSnooze(deps.db, deps.workspaceId, ticket, snooze), ticket);
}

export async function dismissFlags(
  deps: TicketDeps,
  ticket: TicketId,
  flags: readonly string[],
): Promise<void> {
  const unique = [...new Set(flags)];
  requireFound(await setDismissedFlags(deps.db, deps.workspaceId, ticket, unique), ticket);
}

export async function markNoticeSeen(
  deps: TicketDeps,
  ticket: TicketId,
  notice: string,
): Promise<void> {
  requireFound(await setNoticeSeen(deps.db, deps.workspaceId, ticket, notice), ticket);
}

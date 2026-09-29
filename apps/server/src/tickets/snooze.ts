import {
  SNOOZE_MAX_DAYS,
  type SnoozeTicketRequest,
  type TicketSourceId,
} from '@spark-outpost/contracts';
import { setTicketSnooze } from '../persistence/tickets.ts';
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

export async function snoozeTicket(
  deps: TicketDeps,
  ticket: { source: TicketSourceId; key: string },
  request: SnoozeTicketRequest | null,
): Promise<void> {
  const snooze = request
    ? { until: new Date(request.until), rules: [...new Set(request.rules)] }
    : null;
  const found = await setTicketSnooze(deps.db, deps.workspaceId, ticket, snooze);
  if (!found) {
    throw new TicketApiError(
      404,
      `${ticket.key} isn't in your ticket inbox. Refresh and try again.`,
    );
  }
}

import { spanOf, type CalendarEvent } from '@spark-outpost/contracts';
import { canAskJoinAtStart } from '../join-at-start.ts';

export const JOIN_CLOSE_MS = 2 * 60_000;

export type CardLead = 'join' | 'join-at-start' | 'planned';

export function cardLead(event: CalendarEvent, at: number): CardLead {
  const start = spanOf(event).start;
  if (event.joinAtStart && at < start) return 'planned';
  if (start - at > JOIN_CLOSE_MS && canAskJoinAtStart(event, at)) return 'join-at-start';
  return 'join';
}

import {
  addLocalDays,
  eventsInSpan,
  localDayStart,
  type HelperEvent,
} from '@spark-outpost/contracts';
import type { Invitee } from '../people.ts';

export const SYNC_WINDOW_DAYS_BEFORE = 1;
export const SYNC_WINDOW_DAYS_AFTER = 8;

export interface SyncWindow {
  key: string;
  from: number;
  to: number;
}

export function syncWindow(now: number): SyncWindow {
  const today = localDayStart(now);
  const from = addLocalDays(today, -SYNC_WINDOW_DAYS_BEFORE);
  return { key: String(from), from, to: addLocalDays(today, SYNC_WINDOW_DAYS_AFTER) };
}

export interface StoredEvent {
  event: HelperEvent;
  notes: string;
  snippet: string;
  link: string | null;
  invitees: Invitee[];
}

export interface CalendarSync {
  windowKey: string;
  syncToken: string | null;
  truncated: boolean;
  events: Map<string, StoredEvent>;
}

export interface SyncTarget {
  accountId: string;
  calendarId: string;
}

export interface WindowEvents {
  events: HelperEvent[];
  truncated: boolean;
}

export function covers(outer: SyncWindow, inner: { from: number; to: number }): boolean {
  return outer.from <= inner.from && inner.to <= outer.to;
}

function eventsInWindow(sync: CalendarSync, window: { from: number; to: number }): HelperEvent[] {
  const events = [...sync.events.values()].map((entry) => entry.event);
  return eventsInSpan(events, window.from, window.to);
}

export function collectEvents(
  syncs: Iterable<CalendarSync>,
  bounds: { from: number; to: number },
): WindowEvents {
  const events: HelperEvent[] = [];
  let truncated = false;
  for (const sync of syncs) {
    truncated ||= sync.truncated;
    events.push(...eventsInWindow(sync, bounds));
  }
  return { events, truncated };
}

export function findStored(
  syncs: Iterable<CalendarSync>,
  eventId: string,
  at: number,
): StoredEvent | null {
  for (const sync of syncs) {
    const found = sync.events.get(eventId);
    if (found && Date.parse(found.event.start) === at) return found;
  }
  return null;
}

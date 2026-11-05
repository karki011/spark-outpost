import {
  addLocalDays,
  eventsInSpan,
  localDayStart,
  type HelperEvent,
} from '@spark-outpost/contracts';
import type { Invitee } from '../people.ts';
import { GoogleApiError, listGoogleEvents, type GoogleApiDeps, type GoogleEvent } from './api.ts';
import {
  googleEventId,
  googleHtmlLink,
  googleInvitees,
  mapGoogleEvent,
  notesSnippet,
  notesText,
} from './map.ts';

export const GOOGLE_WINDOW_DAYS_BEFORE = 1;
export const GOOGLE_WINDOW_DAYS_AFTER = 8;

export interface GoogleWindow {
  key: string;
  from: number;
  to: number;
}

export function googleWindow(now: number): GoogleWindow {
  const today = localDayStart(now);
  const from = addLocalDays(today, -GOOGLE_WINDOW_DAYS_BEFORE);
  return { key: String(from), from, to: addLocalDays(today, GOOGLE_WINDOW_DAYS_AFTER) };
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

export function storedEvent(target: SyncTarget, raw: GoogleEvent): StoredEvent | null {
  const event = mapGoogleEvent(target.accountId, target.calendarId, raw);
  if (!event) return null;
  return {
    event,
    notes: notesText(raw.description),
    snippet: notesSnippet(raw.description),
    link: googleHtmlLink(raw.htmlLink),
    invitees: googleInvitees(raw.attendees),
  };
}

function apply(target: SyncTarget, events: Map<string, StoredEvent>, changes: GoogleEvent[]) {
  for (const raw of changes) {
    const next = storedEvent(target, raw);
    const id = googleEventId(target.accountId, raw.id);
    if (next) events.set(id, next);
    else events.delete(id);
  }
}

export async function fullSync(
  api: GoogleApiDeps,
  target: SyncTarget,
  window: GoogleWindow,
): Promise<CalendarSync> {
  const answer = await listGoogleEvents(api, target.calendarId, {
    kind: 'full',
    timeMin: new Date(window.from).toISOString(),
    timeMax: new Date(window.to).toISOString(),
  });
  const events = new Map<string, StoredEvent>();
  apply(target, events, answer.events);
  return {
    windowKey: window.key,
    syncToken: answer.syncToken,
    truncated: answer.truncated,
    events,
  };
}

export interface SyncResult {
  sync: CalendarSync;
  changed: boolean;
}

export async function syncCalendar(
  api: GoogleApiDeps,
  target: SyncTarget,
  previous: CalendarSync | null,
  window: GoogleWindow,
): Promise<SyncResult> {
  const token = previous?.windowKey === window.key ? previous.syncToken : null;
  if (!previous || !token) {
    return { sync: await fullSync(api, target, window), changed: true };
  }
  try {
    const answer = await listGoogleEvents(api, target.calendarId, {
      kind: 'changes',
      syncToken: token,
    });
    const events = new Map(previous.events);
    apply(target, events, answer.events);
    return {
      sync: {
        windowKey: window.key,
        syncToken: answer.syncToken,
        truncated: previous.truncated || answer.truncated,
        events,
      },
      changed: answer.events.length > 0,
    };
  } catch (error) {
    if (!(error instanceof GoogleApiError) || error.kind !== 'gone') throw error;
    return { sync: await fullSync(api, target, window), changed: true };
  }
}

export function covers(outer: GoogleWindow, inner: { from: number; to: number }): boolean {
  return outer.from <= inner.from && inner.to <= outer.to;
}

function eventsInWindow(sync: CalendarSync, window: { from: number; to: number }): HelperEvent[] {
  const events = [...sync.events.values()].map((entry) => entry.event);
  return eventsInSpan(events, window.from, window.to);
}

export function collectEvents(
  syncs: Iterable<CalendarSync>,
  bounds: { from: number; to: number },
): { events: HelperEvent[]; truncated: boolean } {
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

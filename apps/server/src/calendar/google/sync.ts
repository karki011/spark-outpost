import { GoogleApiError, listGoogleEvents, type GoogleApiDeps, type GoogleEvent } from './api.ts';
import type { CalendarSync, StoredEvent, SyncTarget, SyncWindow } from '../cloud/events.ts';
import { googleEventId, googleHtmlLink, googleInvitees, mapGoogleEvent } from './map.ts';
import { notesSnippet, notesText } from '../cloud/notes.ts';

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
  window: SyncWindow,
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
  window: SyncWindow,
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

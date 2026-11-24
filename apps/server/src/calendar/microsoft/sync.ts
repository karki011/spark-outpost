import type { CalendarSync, StoredEvent, SyncTarget, SyncWindow } from '../cloud/events.ts';
import { notesSnippet, notesText } from '../cloud/notes.ts';
import { settleAll } from '../cloud/poll.ts';
import {
  GraphApiError,
  listMicrosoftEvents,
  microsoftSeriesUid,
  type GraphApiDeps,
  type GraphEvent,
} from './api.ts';
import {
  mapMicrosoftEvent,
  microsoftEventId,
  microsoftInvitees,
  microsoftNotes,
  microsoftWebLink,
} from './map.ts';

export interface MicrosoftTarget extends SyncTarget {
  email: string;
  seriesUids: Map<string, string | null>;
}

export function storedMicrosoftEvent(target: MicrosoftTarget, raw: GraphEvent): StoredEvent | null {
  const seriesUid = raw.seriesMasterId ? (target.seriesUids.get(raw.seriesMasterId) ?? null) : null;
  const event = mapMicrosoftEvent({ ...target, seriesUid }, raw);
  if (!event) return null;
  const notes = microsoftNotes(raw);
  return {
    event,
    notes: notesText(notes),
    snippet: notesSnippet(notes),
    link: microsoftWebLink(raw.webLink),
    invitees: microsoftInvitees(raw, target.email),
  };
}

export async function resolveSeries(
  api: GraphApiDeps,
  target: MicrosoftTarget,
  events: readonly GraphEvent[],
): Promise<void> {
  const missing = [
    ...new Set(events.flatMap((event) => (event.seriesMasterId ? [event.seriesMasterId] : []))),
  ].filter((id) => !target.seriesUids.has(id));
  const results = await settleAll(missing, (id) => microsoftSeriesUid(api, target.calendarId, id));
  results.forEach((result, index) => {
    const id = missing[index]!;
    if (result.status === 'fulfilled') target.seriesUids.set(id, result.value);
    else if (
      result.reason instanceof GraphApiError &&
      ['not_found', 'forbidden'].includes(result.reason.kind)
    ) {
      target.seriesUids.set(id, null);
    } else throw result.reason;
  });
}

function apply(
  target: MicrosoftTarget,
  events: Map<string, StoredEvent>,
  changes: { events: GraphEvent[]; removed: string[] },
) {
  for (const id of changes.removed) events.delete(microsoftEventId(target.accountId, id));
  for (const raw of changes.events) {
    const next = storedMicrosoftEvent(target, raw);
    const id = microsoftEventId(target.accountId, raw.id);
    if (next) events.set(id, next);
    else events.delete(id);
  }
}

export async function fullSync(
  api: GraphApiDeps,
  target: MicrosoftTarget,
  window: SyncWindow,
): Promise<CalendarSync> {
  const answer = await listMicrosoftEvents(api, target.calendarId, {
    kind: 'full',
    start: new Date(window.from).toISOString(),
    end: new Date(window.to).toISOString(),
  });
  await resolveSeries(api, target, answer.events);
  const events = new Map<string, StoredEvent>();
  apply(target, events, answer);
  return {
    windowKey: window.key,
    syncToken: answer.deltaLink,
    truncated: answer.truncated,
    events,
  };
}

export async function syncCalendar(
  api: GraphApiDeps,
  target: MicrosoftTarget,
  previous: CalendarSync | null,
  window: SyncWindow,
): Promise<{ sync: CalendarSync; changed: boolean }> {
  const token = previous?.windowKey === window.key ? previous.syncToken : null;
  if (!previous || !token) {
    return { sync: await fullSync(api, target, window), changed: true };
  }
  try {
    const answer = await listMicrosoftEvents(api, target.calendarId, {
      kind: 'changes',
      deltaLink: token,
    });
    await resolveSeries(api, target, answer.events);
    const events = new Map(previous.events);
    apply(target, events, answer);
    return {
      sync: {
        windowKey: window.key,
        syncToken: answer.deltaLink,
        truncated: previous.truncated || answer.truncated,
        events,
      },
      changed: answer.events.length > 0 || answer.removed.length > 0,
    };
  } catch (error) {
    if (!(error instanceof GraphApiError) || error.kind !== 'gone') throw error;
    return { sync: await fullSync(api, target, window), changed: true };
  }
}

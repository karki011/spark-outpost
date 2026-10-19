import {
  addLocalDays,
  localDayStart,
  type CalendarEventFacts,
  type CalendarEventFields,
} from '@spark-outpost/contracts';
import type { Db } from '../../persistence/db.ts';
import type { SecretStore } from '../../setup/secrets.ts';
import {
  liveAccount,
  needsSignInAgain,
  withFreshToken,
  type LiveAccount,
} from '../google/accounts.ts';
import {
  GoogleApiError,
  deleteGoogleEvent,
  getGoogleEvent,
  insertGoogleEvent,
  patchGoogleEvent,
  type GoogleApiDeps,
  type GoogleEvent,
  type GoogleEventWrite,
} from '../google/api.ts';
import type { GoogleClientConfig } from '../google/config.ts';
import { splitGoogleEventId } from '../google/map.ts';
import { googleAccounts, type GoogleAccountRow } from '../google/store.ts';
import { collectEvents, fullSync, storedEvent, type CalendarSync } from '../google/sync.ts';
import { peopleOf } from '../people.ts';
import { dateKey } from '../service.ts';
import { savedChoices } from '../store.ts';
import { CalendarAgentError, type AgentEventDetail } from './detail.ts';

export interface GoogleAgentDeps {
  db: Db;
  secrets: SecretStore;
  fetch: typeof fetch;
  client: GoogleClientConfig;
  now?: () => number;
}

export interface GoogleReads {
  reconcile(): Promise<void>;
  ready(): boolean;
  window(): { events: never[]; truncated: boolean };
  range(from: number, to: number): Promise<ReturnType<typeof collectEvents>>;
}

export interface GoogleTarget {
  accountId: string;
  calendarId: string;
}

export interface GoogleAgentClient {
  reads(workspaceId: string): GoogleReads;
  account(workspaceId: string, accountId: string): Promise<GoogleAccountRow | null>;
  detail(
    workspaceId: string,
    calendarId: string,
    eventId: string,
    start: string,
  ): Promise<AgentEventDetail | null>;
  save(
    workspaceId: string,
    calendarId: string,
    eventId: string | null,
    write: GoogleEventWrite,
  ): Promise<AgentEventDetail>;
  remove(workspaceId: string, calendarId: string, eventId: string): Promise<void>;
}

export const GOOGLE_SIGN_IN_AGAIN =
  'Google sign-in for that account ran out. Ask the user to select Sign in again on the Calendar card.';

export function googleTarget(calendarId: string): GoogleTarget | null {
  const match = /^google:([^:]+):(.+)$/.exec(calendarId);
  return match ? { accountId: match[1]!, calendarId: match[2]! } : null;
}

const RANGE_CONCURRENCY = 4;

function reminderMinutes(raw: GoogleEvent): number | null {
  if (raw.reminders?.useDefault !== false) return null;
  return raw.reminders.overrides?.[0]?.minutes ?? null;
}

function detailOf(target: GoogleTarget, raw: GoogleEvent): AgentEventDetail | null {
  const stored = storedEvent(target, raw);
  if (!stored) return null;
  const humans = (raw.attendees ?? []).filter((attendee) => !attendee.resource);
  return {
    event: stored.event,
    notes: stored.notes,
    attendees: peopleOf(stored.invitees).map((person) => person.name),
    others: humans.filter((attendee) => !attendee.self).length,
    alarmMinutes: reminderMinutes(raw),
  };
}

function when(at: string, allDay: boolean): { dateTime: string } | { date: string } {
  return allDay ? { date: dateKey(Date.parse(at)) } : { dateTime: new Date(at).toISOString() };
}

function allDayEnd(after: CalendarEventFacts): string {
  const nextDay = addLocalDays(localDayStart(Date.parse(after.start)), 1);
  return new Date(Math.max(Date.parse(after.end), nextDay)).toISOString();
}

export function googleWriteBody(
  fields: CalendarEventFields,
  after: CalendarEventFacts,
): GoogleEventWrite {
  const body: GoogleEventWrite = {};
  if (fields.title !== undefined) body.summary = fields.title;
  if (fields.notes !== undefined) body.description = fields.notes;
  if (fields.location !== undefined) body.location = fields.location;
  const timed = fields.start !== undefined || fields.end !== undefined;
  if (timed || fields.allDay !== undefined) {
    body.start = when(after.start, after.allDay);
    body.end = when(after.allDay ? allDayEnd(after) : after.end, after.allDay);
  }
  if (fields.alarmMinutes !== undefined) {
    body.reminders = {
      useDefault: false,
      overrides:
        fields.alarmMinutes === null ? [] : [{ method: 'popup', minutes: fields.alarmMinutes }],
    };
  }
  return body;
}

async function settled<T, R>(items: readonly T[], work: (item: T) => Promise<R>) {
  const results: PromiseSettledResult<R>[] = [];
  for (let index = 0; index < items.length; index += RANGE_CONCURRENCY) {
    const batch = items.slice(index, index + RANGE_CONCURRENCY);
    results.push(...(await Promise.allSettled(batch.map(work))));
  }
  return results;
}

export function createGoogleAgentClient(deps: GoogleAgentDeps): GoogleAgentClient {
  const now = deps.now ?? Date.now;
  const live = new Map<string, LiveAccount>();

  const accountDeps = (workspaceId: string) => ({ ...deps, workspaceId, now });

  const liveOf = (row: GoogleAccountRow): LiveAccount => {
    const known = live.get(row.id) ?? liveAccount(row);
    known.row = row;
    live.set(row.id, known);
    return known;
  };

  const usableAccount = async (workspaceId: string, accountId: string) => {
    const row = (await googleAccounts(deps.db, workspaceId)).find(
      (candidate) => candidate.id === accountId,
    );
    if (!row) throw new CalendarAgentError('That Google account is no longer connected.');
    if (row.needsSignIn) throw new CalendarAgentError(GOOGLE_SIGN_IN_AGAIN);
    return liveOf(row);
  };

  const withAccount = async <T>(
    workspaceId: string,
    accountId: string,
    work: (api: GoogleApiDeps) => Promise<T>,
  ): Promise<T> => {
    const account = await usableAccount(workspaceId, accountId);
    try {
      return await withFreshToken(accountDeps(workspaceId), account, work);
    } catch (error) {
      if (needsSignInAgain(error)) throw new CalendarAgentError(GOOGLE_SIGN_IN_AGAIN);
      if (error instanceof GoogleApiError) throw new CalendarAgentError(error.message);
      throw error;
    }
  };

  const targetOf = (calendarId: string): GoogleTarget => {
    const target = googleTarget(calendarId);
    if (!target) throw new CalendarAgentError('That is not a Google calendar.');
    return target;
  };

  const googleEventIdOf = (target: GoogleTarget, eventId: string): string => {
    const parts = splitGoogleEventId(eventId);
    if (!parts || parts.accountId !== target.accountId) {
      throw new CalendarAgentError('That event is not on this Google calendar.');
    }
    return parts.eventId;
  };

  const accountRange = async (
    workspaceId: string,
    row: GoogleAccountRow,
    bounds: { from: number; to: number },
  ): Promise<CalendarSync[]> => {
    const prefix = `google:${row.id}:`;
    const calendars = (await savedChoices(deps.db, workspaceId, { googleAccountId: row.id }))
      .filter((choice) => choice.include && choice.calendarId.startsWith(prefix))
      .map((choice) => choice.calendarId.slice(prefix.length));
    const window = { key: `${bounds.from}|${bounds.to}`, ...bounds };
    return withFreshToken(accountDeps(workspaceId), liveOf(row), async (api) => {
      const results = await settled(calendars, (calendarId) =>
        fullSync(api, { accountId: row.id, calendarId }, window),
      );
      return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    });
  };

  return {
    reads(workspaceId) {
      let rows: GoogleAccountRow[] = [];
      return {
        async reconcile() {
          rows = await googleAccounts(deps.db, workspaceId);
        },
        ready: () => rows.some((row) => !row.needsSignIn),
        window: () => ({ events: [], truncated: false }),
        async range(from, to) {
          const usable = rows.filter((row) => !row.needsSignIn);
          const answers = await Promise.allSettled(
            usable.map((row) => accountRange(workspaceId, row, { from, to })),
          );
          const syncs = answers.flatMap((answer) =>
            answer.status === 'fulfilled' ? answer.value : [],
          );
          return collectEvents(syncs, { from, to });
        },
      };
    },
    async account(workspaceId, accountId) {
      const rows = await googleAccounts(deps.db, workspaceId);
      return rows.find((row) => row.id === accountId) ?? null;
    },
    async detail(workspaceId, calendarId, eventId, start) {
      const target = targetOf(calendarId);
      const googleId = googleEventIdOf(target, eventId);
      const raw = await withAccount(workspaceId, target.accountId, (api) =>
        getGoogleEvent(api, target.calendarId, googleId).catch((error: unknown) => {
          if (error instanceof GoogleApiError && error.kind === 'not_found') return null;
          throw error;
        }),
      );
      const found = raw ? detailOf(target, raw) : null;
      return found && Date.parse(found.event.start) === Date.parse(start) ? found : null;
    },
    async save(workspaceId, calendarId, eventId, write) {
      const target = targetOf(calendarId);
      const raw = await withAccount(workspaceId, target.accountId, (api) =>
        eventId === null
          ? insertGoogleEvent(api, target.calendarId, write)
          : patchGoogleEvent(api, target.calendarId, googleEventIdOf(target, eventId), write),
      );
      const after = detailOf(target, raw);
      if (!after) throw new CalendarAgentError('Google saved the event but sent back an odd copy.');
      return after;
    },
    async remove(workspaceId, calendarId, eventId) {
      const target = targetOf(calendarId);
      const googleId = googleEventIdOf(target, eventId);
      await withAccount(workspaceId, target.accountId, (api) =>
        deleteGoogleEvent(api, target.calendarId, googleId),
      );
    },
  };
}

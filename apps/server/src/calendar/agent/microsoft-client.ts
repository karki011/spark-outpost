import {
  addLocalDays,
  localDayStart,
  type CalendarEventFacts,
  type CalendarEventFields,
} from '@spark-outpost/contracts';
import type { Db } from '../../persistence/db.ts';
import type { SecretStore } from '../../setup/secrets.ts';
import { cloudAccounts, cloudOwner, type CloudAccountRow } from '../cloud/account-store.ts';
import { collectEvents, type CalendarSync, type WindowEvents } from '../cloud/events.ts';
import { settleAll } from '../cloud/poll.ts';
import {
  microsoftLiveAccount,
  microsoftPrefix,
  microsoftTarget,
  needsSignInAgain,
  withFreshToken,
  type MicrosoftLiveAccount,
} from '../microsoft/accounts.ts';
import {
  GraphApiError,
  deleteMicrosoftEvent,
  getMicrosoftEvent,
  insertMicrosoftEvent,
  patchMicrosoftEvent,
  type GraphApiDeps,
  type GraphEvent,
  type MicrosoftEventWrite,
} from '../microsoft/api.ts';
import type { MicrosoftClientConfig } from '../microsoft/config.ts';
import { microsoftOthers, splitMicrosoftEventId } from '../microsoft/map.ts';
import { fullSync, resolveSeries, storedMicrosoftEvent } from '../microsoft/sync.ts';
import { peopleOf } from '../people.ts';
import { dateKey } from '../service.ts';
import { savedChoices } from '../store.ts';
import { CalendarAgentError, type AgentEventDetail } from './detail.ts';
import type { CloudCalendarTarget } from './google-client.ts';

export interface MicrosoftAgentDeps {
  db: Db;
  secrets: SecretStore;
  fetch: typeof fetch;
  client: MicrosoftClientConfig;
  now?: () => number;
}

export interface MicrosoftReads {
  reconcile(): Promise<void>;
  ready(): boolean;
  window(): WindowEvents;
  range(from: number, to: number): Promise<WindowEvents>;
}

export interface MicrosoftAgentClient {
  reads(workspaceId: string): MicrosoftReads;
  account(workspaceId: string, accountId: string): Promise<CloudAccountRow | null>;
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
    write: MicrosoftEventWrite,
  ): Promise<AgentEventDetail>;
  remove(workspaceId: string, calendarId: string, eventId: string): Promise<void>;
}

export const MICROSOFT_AGENT_SIGN_IN_AGAIN =
  'Microsoft sign-in for that account ran out. Ask the user to select Sign in again on the Calendar card.';

export function microsoftCalendarTarget(calendarId: string): CloudCalendarTarget | null {
  const match = /^microsoft:([^:]+):(.+)$/.exec(calendarId);
  return match ? { accountId: match[1]!, calendarId: match[2]! } : null;
}

function utcDateTime(at: string): string {
  return new Date(at).toISOString().slice(0, 23);
}

function allDayDateTime(at: string): string {
  return `${dateKey(Date.parse(at))}T00:00:00`;
}

function when(at: string, allDay: boolean): { dateTime: string; timeZone: 'UTC' } {
  return { dateTime: allDay ? allDayDateTime(at) : utcDateTime(at), timeZone: 'UTC' };
}

function allDayEnd(after: CalendarEventFacts): string {
  const nextDay = addLocalDays(localDayStart(Date.parse(after.start)), 1);
  return new Date(Math.max(Date.parse(after.end), nextDay)).toISOString();
}

export function microsoftWriteBody(
  fields: CalendarEventFields,
  after: CalendarEventFacts,
): MicrosoftEventWrite {
  const body: MicrosoftEventWrite = {};
  if (fields.title !== undefined) body.subject = fields.title;
  if (fields.notes !== undefined) body.body = { contentType: 'text', content: fields.notes };
  if (fields.location !== undefined) body.location = { displayName: fields.location };
  const timed = fields.start !== undefined || fields.end !== undefined;
  if (timed || fields.allDay !== undefined) {
    body.isAllDay = after.allDay;
    body.start = when(after.start, after.allDay);
    body.end = when(after.allDay ? allDayEnd(after) : after.end, after.allDay);
  }
  if (fields.alarmMinutes !== undefined) {
    body.isReminderOn = fields.alarmMinutes !== null;
    if (fields.alarmMinutes !== null) body.reminderMinutesBeforeStart = fields.alarmMinutes;
  }
  return body;
}

function detailOf(
  account: MicrosoftLiveAccount,
  calendarId: string,
  raw: GraphEvent,
): AgentEventDetail | null {
  const stored = storedMicrosoftEvent(microsoftTarget(account, calendarId), raw);
  if (!stored) return null;
  return {
    event: stored.event,
    notes: stored.notes,
    attendees: peopleOf(stored.invitees).map((person) => person.name),
    others: microsoftOthers(raw, account.row.email),
    alarmMinutes: raw.isReminderOn ? (raw.reminderMinutesBeforeStart ?? null) : null,
  };
}

export function createMicrosoftAgentClient(deps: MicrosoftAgentDeps): MicrosoftAgentClient {
  const now = deps.now ?? Date.now;
  const live = new Map<string, MicrosoftLiveAccount>();

  const accountDeps = (workspaceId: string) => ({ ...deps, workspaceId, now });

  const liveOf = (row: CloudAccountRow): MicrosoftLiveAccount => {
    const known = live.get(row.id) ?? microsoftLiveAccount(row);
    known.row = row;
    live.set(row.id, known);
    return known;
  };

  const usableAccount = async (workspaceId: string, accountId: string) => {
    const row = (await cloudAccounts(deps.db, 'microsoft', workspaceId)).find(
      (candidate) => candidate.id === accountId,
    );
    if (!row) throw new CalendarAgentError('That Microsoft account is no longer connected.');
    if (row.needsSignIn) throw new CalendarAgentError(MICROSOFT_AGENT_SIGN_IN_AGAIN);
    return liveOf(row);
  };

  const withAccount = async <T>(
    workspaceId: string,
    accountId: string,
    work: (api: GraphApiDeps, account: MicrosoftLiveAccount) => Promise<T>,
  ): Promise<T> => {
    const account = await usableAccount(workspaceId, accountId);
    try {
      return await withFreshToken(accountDeps(workspaceId), account, (api) => work(api, account));
    } catch (error) {
      if (needsSignInAgain(error)) throw new CalendarAgentError(MICROSOFT_AGENT_SIGN_IN_AGAIN);
      if (error instanceof GraphApiError) throw new CalendarAgentError(error.message);
      throw error;
    }
  };

  const targetOf = (calendarId: string): CloudCalendarTarget => {
    const target = microsoftCalendarTarget(calendarId);
    if (!target) throw new CalendarAgentError('That is not a Microsoft calendar.');
    return target;
  };

  const graphIdOf = (target: CloudCalendarTarget, eventId: string): string => {
    const parts = splitMicrosoftEventId(eventId);
    if (!parts || parts.accountId !== target.accountId) {
      throw new CalendarAgentError('That event is not on this Microsoft calendar.');
    }
    return parts.eventId;
  };

  const accountRange = async (
    workspaceId: string,
    row: CloudAccountRow,
    bounds: { from: number; to: number },
  ): Promise<CalendarSync[]> => {
    const prefix = microsoftPrefix(row.id);
    const calendars = (await savedChoices(deps.db, workspaceId, cloudOwner('microsoft', row.id)))
      .filter((choice) => choice.include && choice.calendarId.startsWith(prefix))
      .map((choice) => choice.calendarId.slice(prefix.length));
    const window = { key: `${bounds.from}|${bounds.to}`, ...bounds };
    const account = liveOf(row);
    return withFreshToken(accountDeps(workspaceId), account, async (api) => {
      const results = await settleAll(calendars, (calendarId) =>
        fullSync(api, microsoftTarget(account, calendarId), window),
      );
      return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    });
  };

  return {
    reads(workspaceId) {
      let rows: CloudAccountRow[] = [];
      return {
        async reconcile() {
          rows = await cloudAccounts(deps.db, 'microsoft', workspaceId);
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
      const rows = await cloudAccounts(deps.db, 'microsoft', workspaceId);
      return rows.find((row) => row.id === accountId) ?? null;
    },
    async detail(workspaceId, calendarId, eventId, start) {
      const target = targetOf(calendarId);
      const graphId = graphIdOf(target, eventId);
      const found = await withAccount(workspaceId, target.accountId, async (api, account) => {
        const raw = await getMicrosoftEvent(api, target.calendarId, graphId).catch(
          (error: unknown) => {
            if (error instanceof GraphApiError && error.kind === 'not_found') return null;
            throw error;
          },
        );
        if (!raw) return null;
        await resolveSeries(api, microsoftTarget(account, target.calendarId), [raw]);
        return detailOf(account, target.calendarId, raw);
      });
      return found && Date.parse(found.event.start) === Date.parse(start) ? found : null;
    },
    async save(workspaceId, calendarId, eventId, write) {
      const target = targetOf(calendarId);
      const after = await withAccount(workspaceId, target.accountId, async (api, account) => {
        const raw =
          eventId === null
            ? await insertMicrosoftEvent(api, target.calendarId, write)
            : await patchMicrosoftEvent(
                api,
                { calendarId: target.calendarId, eventId: graphIdOf(target, eventId) },
                write,
              );
        await resolveSeries(api, microsoftTarget(account, target.calendarId), [raw]);
        return detailOf(account, target.calendarId, raw);
      });
      if (!after) {
        throw new CalendarAgentError('Microsoft saved the event but sent back an odd copy.');
      }
      return after;
    },
    async remove(workspaceId, calendarId, eventId) {
      const target = targetOf(calendarId);
      const graphId = graphIdOf(target, eventId);
      await withAccount(workspaceId, target.accountId, (api) =>
        deleteMicrosoftEvent(api, { calendarId: target.calendarId, eventId: graphId }),
      );
    },
  };
}

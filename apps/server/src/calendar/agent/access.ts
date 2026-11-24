import type {
  CalendarChoice,
  CalendarEditSpan,
  CalendarEventFacts,
  CalendarEventFields,
} from '@spark-outpost/contracts';
import type { Db } from '../../persistence/db.ts';
import { CalendarHostError, type CalendarHost } from '../host-client.ts';
import type { CalendarReadDeps } from '../service.ts';
import { CalendarAgentError, helperAgentDetail, type AgentEventDetail } from './detail.ts';
import {
  createGoogleAgentClient,
  googleTarget,
  googleWriteBody,
  type GoogleAgentClient,
  type GoogleAgentDeps,
} from './google-client.ts';
import {
  createMicrosoftAgentClient,
  microsoftCalendarTarget,
  microsoftWriteBody,
  type MicrosoftAgentClient,
  type MicrosoftAgentDeps,
} from './microsoft-client.ts';

export interface AgentCalendarHosts {
  host: CalendarHost | null;
  google: GoogleAgentClient | null;
  microsoft?: MicrosoftAgentClient | null;
}

export interface AgentCalendar extends AgentCalendarHosts {
  db: Db;
  workspaceId: string;
  now: () => number;
}

export interface EventTarget {
  eventId: string;
  occurrence: string;
}

export const CALENDAR_WRITTEN_CHANNEL = 'calendar_written';

export interface AgentCalendarDeps extends Omit<GoogleAgentDeps, 'client'> {
  client: GoogleAgentDeps['client'] | null;
  microsoftClient: MicrosoftAgentDeps['client'] | null;
}

export function agentCalendarHosts(
  host: CalendarHost | null,
  deps: AgentCalendarDeps,
): AgentCalendarHosts | undefined {
  if (!host) return undefined;
  const { client, microsoftClient, ...rest } = deps;
  return {
    host,
    google: client ? createGoogleAgentClient({ ...rest, client }) : null,
    microsoft: microsoftClient
      ? createMicrosoftAgentClient({ ...rest, client: microsoftClient })
      : null,
  };
}

export function agentReadDeps(calendar: AgentCalendar): CalendarReadDeps {
  return {
    db: calendar.db,
    workspaceId: calendar.workspaceId,
    host: calendar.host,
    google: calendar.google?.reads(calendar.workspaceId) ?? null,
    microsoft: calendar.microsoft?.reads(calendar.workspaceId) ?? null,
    now: calendar.now,
  };
}

function isGoogle(choice: CalendarChoice): boolean {
  return choice.sourceKind === 'google';
}

function isMicrosoft(choice: CalendarChoice): boolean {
  return choice.sourceKind === 'microsoft';
}

export async function cloudCanEdit(calendar: AgentCalendar, calendarId: string): Promise<boolean> {
  const google = googleTarget(calendarId);
  if (google && calendar.google) {
    return (
      (await calendar.google.account(calendar.workspaceId, google.accountId))?.canEdit ?? false
    );
  }
  const microsoft = microsoftCalendarTarget(calendarId);
  if (microsoft && calendar.microsoft) {
    const account = await calendar.microsoft.account(calendar.workspaceId, microsoft.accountId);
    return account?.canEdit ?? false;
  }
  return false;
}

function needHost(calendar: AgentCalendar): CalendarHost {
  if (!calendar.host) {
    throw new CalendarAgentError('macOS Calendar is only reachable in the Spark Outpost Mac app.');
  }
  return calendar.host;
}

function needGoogle(calendar: AgentCalendar): GoogleAgentClient {
  if (!calendar.google) throw new CalendarAgentError('This build has no Google sign-in.');
  return calendar.google;
}

function needMicrosoft(calendar: AgentCalendar): MicrosoftAgentClient {
  if (!calendar.microsoft) throw new CalendarAgentError('This build has no Microsoft sign-in.');
  return calendar.microsoft;
}

async function host<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof CalendarHostError) throw new CalendarAgentError(error.message);
    throw error;
  }
}

export async function agentDetail(
  calendar: AgentCalendar,
  choice: CalendarChoice,
  target: EventTarget,
): Promise<AgentEventDetail | null> {
  if (isGoogle(choice) || isMicrosoft(choice)) {
    const cloud = isGoogle(choice) ? needGoogle(calendar) : needMicrosoft(calendar);
    return cloud.detail(calendar.workspaceId, choice.calendarId, target.eventId, target.occurrence);
  }
  try {
    const detail = await needHost(calendar).request({
      op: 'event',
      eventId: target.eventId,
      start: target.occurrence,
    });
    return detail.event.calendarId === choice.calendarId ? helperAgentDetail(detail) : null;
  } catch (error) {
    if (error instanceof CalendarHostError && error.code === 'not_found') return null;
    if (error instanceof CalendarHostError) throw new CalendarAgentError(error.message);
    throw error;
  }
}

export interface AgentSave {
  choice: CalendarChoice;
  target: EventTarget | null;
  fields: CalendarEventFields;
  span: CalendarEditSpan;
  after: CalendarEventFacts;
}

async function announceWrite(db: Db): Promise<void> {
  await db.query(`SELECT pg_notify($1, '')`, [CALENDAR_WRITTEN_CHANNEL]);
  await db.query(`SELECT pg_notify('changes', $1)`, [
    JSON.stringify({ kind: 'calendar', conversationId: null, runId: null }),
  ]);
}

export async function agentSave(
  calendar: AgentCalendar,
  save: AgentSave,
): Promise<AgentEventDetail> {
  const { choice, target, fields } = save;
  const eventId = target?.eventId ?? null;
  const after = isGoogle(choice)
    ? await needGoogle(calendar).save(
        calendar.workspaceId,
        choice.calendarId,
        eventId,
        googleWriteBody(fields, save.after),
      )
    : isMicrosoft(choice)
      ? await needMicrosoft(calendar).save(
          calendar.workspaceId,
          choice.calendarId,
          eventId,
          microsoftWriteBody(fields, save.after),
        )
      : helperAgentDetail(
          (
            await host(
              needHost(calendar).request({
                op: 'save',
                calendarId: choice.calendarId,
                ...(target ? { eventId: target.eventId, occurrence: target.occurrence } : {}),
                fields,
                span: save.span,
              }),
            )
          ).after,
        );
  await announceWrite(calendar.db);
  return after;
}

export async function agentRemove(
  calendar: AgentCalendar,
  choice: CalendarChoice,
  target: EventTarget,
  span: CalendarEditSpan,
): Promise<void> {
  if (isGoogle(choice) || isMicrosoft(choice)) {
    const cloud = isGoogle(choice) ? needGoogle(calendar) : needMicrosoft(calendar);
    await cloud.remove(calendar.workspaceId, choice.calendarId, target.eventId);
  } else {
    await host(
      needHost(calendar).request({
        op: 'remove',
        eventId: target.eventId,
        start: target.occurrence,
        span,
      }),
    );
  }
  await announceWrite(calendar.db);
}

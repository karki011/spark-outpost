import type {
  CalendarChoice,
  CalendarEditSpan,
  CalendarEventFields,
} from '@spark-outpost/contracts';
import type { Db } from '../../persistence/db.ts';
import { CalendarHostError, type CalendarHost } from '../host-client.ts';
import type { CalendarReadDeps } from '../service.ts';
import { CalendarAgentError, helperAgentDetail, type AgentEventDetail } from './detail.ts';
import {
  createGoogleAgentClient,
  googleWriteBody,
  type GoogleAgentClient,
  type GoogleAgentDeps,
} from './google-client.ts';

export interface AgentCalendarHosts {
  host: CalendarHost | null;
  google: GoogleAgentClient | null;
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

export function agentCalendarHosts(
  host: CalendarHost | null,
  google: Omit<GoogleAgentDeps, 'client'> & { client: GoogleAgentDeps['client'] | null },
): AgentCalendarHosts | undefined {
  if (!host) return undefined;
  const { client, ...rest } = google;
  return { host, google: client ? createGoogleAgentClient({ ...rest, client }) : null };
}

export function agentReadDeps(calendar: AgentCalendar): CalendarReadDeps {
  return {
    db: calendar.db,
    workspaceId: calendar.workspaceId,
    host: calendar.host,
    google: calendar.google?.reads(calendar.workspaceId) ?? null,
    now: calendar.now,
  };
}

function isGoogle(choice: CalendarChoice): boolean {
  return choice.sourceKind === 'google';
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
  if (isGoogle(choice)) {
    return needGoogle(calendar).detail(
      calendar.workspaceId,
      choice.calendarId,
      target.eventId,
      target.occurrence,
    );
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
  allDay: boolean;
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
  const after = isGoogle(choice)
    ? await needGoogle(calendar).save(
        calendar.workspaceId,
        choice.calendarId,
        target?.eventId ?? null,
        googleWriteBody(fields, save.allDay),
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
  if (isGoogle(choice)) {
    await needGoogle(calendar).remove(calendar.workspaceId, choice.calendarId, target.eventId);
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

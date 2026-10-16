import {
  CALENDAR_DEFAULT_SETTINGS,
  addLocalDays,
  dayShape,
  eventsOnDay,
  freeBlocks,
  isMeeting,
  localDayStart,
  mergeEvents,
  type CalendarAccount,
  type CalendarAuthorization,
  type CalendarChoice,
  type CalendarDay,
  type CalendarEvent,
  type CalendarEventDetail,
  type CalendarHelperState,
  type CalendarNow,
  type CalendarStatus,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import type { CalendarHost } from './host-client.ts';
import { planNudges, type PlannerChat } from './planner.ts';
import { lostNotice, rematchCalendars } from './rematch.ts';
import {
  calendarConnection,
  calendarMarks,
  replaceChoices,
  savedChoices,
  setNotice,
} from './store.ts';

export interface CalendarDeps {
  db: Db;
  workspaceId: string;
  host: CalendarHost | null;
  now?: () => number;
}

interface Reading {
  connected: boolean;
  authorization: CalendarAuthorization | null;
  helper: CalendarHelperState | null;
}

export interface CalendarState {
  reading: Reading;
  choices: CalendarChoice[];
  events: CalendarEvent[];
  truncated: boolean;
  settings: CalendarStatus['settings'];
}

export function dateKey(at: number): string {
  const day = new Date(at);
  const month = String(day.getMonth() + 1).padStart(2, '0');
  const date = String(day.getDate()).padStart(2, '0');
  return `${day.getFullYear()}-${month}-${date}`;
}

export function dayFromKey(key: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(day.getTime()) ? null : day.getTime();
}

function accountsOf(choices: readonly CalendarChoice[]): CalendarAccount[] {
  const accounts = new Map<string, CalendarAccount>();
  for (const choice of choices) {
    const account = accounts.get(choice.sourceId) ?? {
      id: choice.sourceId,
      title: choice.sourceTitle,
      kind: choice.sourceKind,
      calendars: [],
    };
    account.calendars.push(choice);
    accounts.set(choice.sourceId, account);
  }
  return [...accounts.values()];
}

export async function readHost(deps: CalendarDeps): Promise<Reading> {
  const connection = await calendarConnection(deps.db, deps.workspaceId);
  if (!deps.host) return { connected: connection.connected, authorization: null, helper: null };
  const status = await deps.host.request({ op: 'status' });
  return {
    connected: connection.connected,
    authorization: status.authorization,
    helper: status.helper,
  };
}

function readable(reading: Reading): boolean {
  return reading.connected && reading.helper === 'ready' && reading.authorization === 'fullAccess';
}

export async function syncCalendars(deps: CalendarDeps): Promise<CalendarChoice[]> {
  const saved = await savedChoices(deps.db, deps.workspaceId);
  if (!deps.host) return saved;
  const { calendars } = await deps.host.request({ op: 'calendars' });
  const match = rematchCalendars(saved, calendars);
  if (!match.changed) return saved;
  await replaceChoices(deps.db, deps.workspaceId, match.writes);
  const notice = lostNotice(match.lost);
  if (notice) await setNotice(deps.db, deps.workspaceId, notice);
  return savedChoices(deps.db, deps.workspaceId);
}

export async function calendarStatus(deps: CalendarDeps): Promise<CalendarStatus> {
  const connection = await calendarConnection(deps.db, deps.workspaceId);
  const reading = await readHost(deps);
  const choices = readable(reading)
    ? await syncCalendars(deps)
    : await savedChoices(deps.db, deps.workspaceId);
  const after = await calendarConnection(deps.db, deps.workspaceId);
  return {
    supported: deps.host !== null,
    helper: reading.helper,
    authorization: reading.authorization,
    connected: connection.connected,
    accounts: connection.connected ? accountsOf(choices) : [],
    notice: after.notice,
    settings: connection.settings,
  };
}

export async function calendarState(deps: CalendarDeps): Promise<CalendarState> {
  const now = deps.now?.() ?? Date.now();
  const connection = await calendarConnection(deps.db, deps.workspaceId);
  const reading = connection.connected
    ? await readHost(deps)
    : { connected: false, authorization: null, helper: null };
  if (!readable(reading) || !deps.host) {
    return {
      reading,
      choices: [],
      events: [],
      truncated: false,
      settings: connection.connected ? connection.settings : CALENDAR_DEFAULT_SETTINGS,
    };
  }
  const choices = await syncCalendars(deps);
  const window = await deps.host.request({ op: 'window' });
  const marks = await calendarMarks(deps.db, deps.workspaceId, new Date(now));
  const events = mergeEvents({
    events: window.events,
    calendars: choices,
    focusNames: connection.settings.focusNames,
    marks,
  });
  return { reading, choices, events, truncated: window.truncated, settings: connection.settings };
}

const WEEK_DAYS = 7;

export function calendarDay(state: CalendarState, dayStart: number, now: number): CalendarDay {
  const events = eventsOnDay(state.events, dayStart);
  const today = localDayStart(now);
  const week = Array.from({ length: WEEK_DAYS }, (_, index) => {
    const start = addLocalDays(today, index);
    const day = eventsOnDay(state.events, start).filter((event) => !event.allDay);
    return {
      date: dateKey(start),
      meetings: day.filter(isMeeting).length,
      focus: day.filter((event) => event.focus).length,
    };
  });
  return {
    date: dateKey(dayStart),
    today: dateKey(today),
    events,
    free: freeBlocks(events, dayStart),
    shape: dayShape(events, dayStart),
    week,
    calendars: state.choices.filter((choice) => choice.include),
    truncated: state.truncated,
  };
}

export async function plannerChats(db: Db, workspaceId: string): Promise<PlannerChat[]> {
  const { rows } = await db.query<PlannerChat>(
    `SELECT c.id, c.title,
       EXISTS (SELECT 1 FROM runs r WHERE r.conversation_id = c.id
         AND r.status IN ('queued', 'running')) AS running,
       EXISTS (SELECT 1 FROM approvals a JOIN runs r ON r.id = a.run_id
         WHERE r.conversation_id = c.id AND a.status = 'pending') AS "needsYou"
     FROM conversations c
     WHERE c.workspace_id = $1 AND c.kind = 'chat' AND c.archived_at IS NULL
       AND c.id IS DISTINCT FROM (
         SELECT assistant_conversation_id FROM profiles WHERE workspace_id = $1)
     ORDER BY c.updated_at DESC
     LIMIT 50`,
    [workspaceId],
  );
  return rows.filter((row) => row.running || row.needsYou);
}

export function calendarNow(
  state: CalendarState,
  chats: readonly PlannerChat[],
  now: number,
): CalendarNow {
  const active = readable(state.reading);
  const plan = planNudges(state.events, chats, state.settings, now);
  return {
    active,
    ...plan,
    calendars: state.choices.filter((choice) => choice.include),
  };
}

export async function eventDetail(
  host: CalendarHost,
  occurrence: { eventId: string; start: string },
): Promise<CalendarEventDetail> {
  const detail = await host.request({ op: 'event', ...occurrence });
  return { title: detail.event.title, notes: detail.notes };
}

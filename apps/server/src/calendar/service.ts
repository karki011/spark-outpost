import {
  CALENDAR_ATTENDEES_MAX,
  CALENDAR_DEFAULT_SETTINGS,
  addLocalDays,
  dayShape,
  eventsOnDay,
  freeBlocks,
  isMeeting,
  localDayStart,
  mergeEvents,
  overlaps,
  spanOf,
  type CalendarAccount,
  type CalendarAuthorization,
  type CalendarChoice,
  type CalendarDay,
  type CalendarEvent,
  type CalendarEventDetail,
  type CalendarGoogleStatus,
  type CalendarHelperState,
  type CalendarNow,
  type CalendarRange,
  type CalendarSpan,
  type CalendarStatus,
  type HelperEvent,
} from '@spark-outpost/contracts';
import { withTransaction, type Db } from '../persistence/db.ts';
import type { CalendarHost } from './host-client.ts';
import { googleSourceId } from './google/map.ts';
import type { GoogleSource } from './google/source.ts';
import { planNudges, type PlannerChat } from './planner.ts';
import { linkFreeSnippet } from './snippet.ts';
import { lostNotice, rematchCalendars } from './rematch.ts';
import {
  EVENTKIT_OWNER,
  calendarConnection,
  calendarMarks,
  lockChoices,
  replaceChoices,
  savedChoices,
  setNotice,
} from './store.ts';

export interface CalendarDeps {
  db: Db;
  workspaceId: string;
  host: CalendarHost | null;
  google?: GoogleSource | null;
  now?: () => number;
}

const NO_GOOGLE: CalendarGoogleStatus = {
  available: false,
  testing: false,
  accounts: [],
  signIn: { status: 'idle', authorizeUrl: null, expiresAt: null, message: null },
};

interface Reading {
  connected: boolean;
  authorization: CalendarAuthorization | null;
  helper: CalendarHelperState | null;
}

export interface CalendarState {
  reading: Reading;
  active: boolean;
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
  const [year, month, date] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const day = new Date(year, month, date);
  const exact = day.getFullYear() === year && day.getMonth() === month && day.getDate() === date;
  return exact ? day.getTime() : null;
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
  if (!deps.host) return savedChoices(deps.db, deps.workspaceId, EVENTKIT_OWNER);
  const { calendars } = await deps.host.request({ op: 'calendars' });
  await withTransaction(deps.db, async (client) => {
    await lockChoices(client, deps.workspaceId, EVENTKIT_OWNER);
    const saved = await savedChoices(client, deps.workspaceId, EVENTKIT_OWNER);
    const match = rematchCalendars(saved, calendars);
    if (!match.changed) return;
    await replaceChoices(client, deps.workspaceId, match.writes, EVENTKIT_OWNER);
    const notice = lostNotice(match.lost);
    if (notice) await setNotice(client, deps.workspaceId, notice);
  });
  return savedChoices(deps.db, deps.workspaceId, EVENTKIT_OWNER);
}

async function googleChoices(deps: CalendarDeps): Promise<CalendarChoice[]> {
  if (!deps.google) return [];
  const all = await savedChoices(deps.db, deps.workspaceId);
  return all.filter((choice) => choice.sourceKind === 'google');
}

function googleStatus(deps: CalendarDeps): CalendarGoogleStatus {
  return deps.google?.status() ?? NO_GOOGLE;
}

export async function calendarStatus(deps: CalendarDeps): Promise<CalendarStatus> {
  await deps.google?.reconcile();
  const connection = await calendarConnection(deps.db, deps.workspaceId);
  const reading = await readHost(deps);
  const macChoices = readable(reading)
    ? await syncCalendars(deps)
    : await savedChoices(deps.db, deps.workspaceId, EVENTKIT_OWNER);
  const after = await calendarConnection(deps.db, deps.workspaceId);
  const google = googleStatus(deps);
  const googleAccounts = accountsOf(await googleChoices(deps));
  const signedIn = google.accounts.map((account) => googleAccountOf(account, googleAccounts));
  return {
    supported: deps.host !== null,
    helper: reading.helper,
    authorization: reading.authorization,
    connected: connection.connected,
    accounts: [...(connection.connected ? accountsOf(macChoices) : []), ...signedIn],
    notice: after.notice,
    settings: connection.settings,
    google,
  };
}

function googleAccountOf(
  account: CalendarGoogleStatus['accounts'][number],
  withCalendars: readonly CalendarAccount[],
): CalendarAccount {
  const id = googleSourceId(account.id);
  return (
    withCalendars.find((candidate) => candidate.id === id) ?? {
      id,
      title: account.email,
      kind: 'google',
      calendars: [],
    }
  );
}

interface SourceEvents {
  events: HelperEvent[];
  truncated: boolean;
}

async function eachSpan(
  spans: readonly CalendarSpan[],
  read: (span: CalendarSpan) => Promise<SourceEvents>,
): Promise<SourceEvents> {
  const answers = await Promise.all(spans.map(read));
  const seen = new Map<string, HelperEvent>();
  for (const answer of answers) {
    for (const event of answer.events) seen.set(`${event.id}|${event.start}`, event);
  }
  return { events: [...seen.values()], truncated: answers.some((answer) => answer.truncated) };
}

async function macEvents(
  deps: CalendarDeps,
  reading: Reading,
  spans: readonly CalendarSpan[] | null,
) {
  const host = deps.host;
  if (!readable(reading) || !host) return { choices: [], events: [], truncated: false };
  const choices = await syncCalendars(deps);
  const read = spans
    ? await eachSpan(spans, (span) =>
        host.request({
          op: 'range',
          from: new Date(span.start).toISOString(),
          to: new Date(span.end).toISOString(),
        }),
      )
    : await host.request({ op: 'window' });
  return { choices, events: read.events, truncated: read.truncated };
}

async function googleEvents(
  deps: CalendarDeps,
  spans: readonly CalendarSpan[] | null,
): Promise<SourceEvents> {
  const google = deps.google;
  if (!google) return { events: [], truncated: false };
  if (!spans) return google.window();
  return eachSpan(spans, (span) => google.range(span.start, span.end));
}

export async function calendarState(
  deps: CalendarDeps,
  spans: readonly CalendarSpan[] | null = null,
): Promise<CalendarState> {
  await deps.google?.reconcile();
  const now = deps.now?.() ?? Date.now();
  const connection = await calendarConnection(deps.db, deps.workspaceId);
  const reading = connection.connected
    ? await readHost(deps)
    : { connected: false, authorization: null, helper: null };
  const [mac, google] = await Promise.all([
    macEvents(deps, reading, spans),
    googleEvents(deps, spans),
  ]);
  const googleReady = deps.google?.ready() ?? false;
  const choices = [...mac.choices, ...(googleReady ? await googleChoices(deps) : [])];
  const active = readable(reading) || googleReady;
  const settings = active || connection.connected ? connection.settings : CALENDAR_DEFAULT_SETTINGS;
  if (!active) {
    return { reading, active, choices: [], events: [], truncated: false, settings };
  }
  const marks = await calendarMarks(deps.db, deps.workspaceId, new Date(now));
  const events = mergeEvents({
    events: [...mac.events, ...google.events],
    calendars: choices,
    focusNames: connection.settings.focusNames,
    marks,
  });
  return {
    reading,
    active,
    choices,
    events,
    truncated: mac.truncated || google.truncated,
    settings,
  };
}

const WEEK_DAYS = 7;
const ATTENDEE_NAME_MAX = 300;

export function dayAndWeek(dayStart: number, now: number): CalendarSpan[] {
  const today = localDayStart(now);
  const week = { start: today, end: addLocalDays(today, WEEK_DAYS) };
  const day = { start: dayStart, end: addLocalDays(dayStart, 1) };
  const inWeek = day.start >= week.start && day.end <= week.end;
  return inWeek ? [week] : [day, week];
}

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

export function calendarRange(
  state: CalendarState,
  range: CalendarSpan,
  now: number,
): CalendarRange {
  const events = state.events
    .map((event) => ({ event, span: spanOf(event) }))
    .filter(({ span }) => overlaps(span, range.start, range.end))
    .toSorted((a, b) => a.span.start - b.span.start)
    .map(({ event }) => event);
  return {
    from: dateKey(range.start),
    to: dateKey(range.end),
    today: dateKey(localDayStart(now)),
    events,
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
  const active = state.active;
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
  const detail = await host.request({
    op: 'event',
    eventId: occurrence.eventId,
    start: occurrence.start,
  });
  const attendees = detail.attendees
    .filter((attendee) => !attendee.isMe && attendee.name.trim())
    .map((attendee) => attendee.name.trim().slice(0, ATTENDEE_NAME_MAX))
    .slice(0, CALENDAR_ATTENDEES_MAX);
  return {
    title: detail.event.title,
    notes: detail.notes,
    snippet: linkFreeSnippet(detail.notes),
    link: null,
    attendees,
  };
}

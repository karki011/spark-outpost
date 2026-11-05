import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarHostRequest, HelperCalendar, HelperEvent } from '@spark-outpost/contracts';
import type { CalendarHost } from '../src/calendar/host-client.ts';
import { savedChoices, setConnected, updateChoice, updateSettings } from '../src/calendar/store.ts';
import { syncCalendars } from '../src/calendar/service.ts';
import { startCalendarTicker, type CalendarTicker } from '../src/calendar/ticker.ts';
import { createTestDb, type TestDb } from './support.ts';

const MINUTE = 60_000;
const NOW = new Date(2026, 9, 16, 10, 0).getTime();

const WORK: HelperCalendar = {
  id: 'work-1',
  title: 'Work',
  sourceId: 'local',
  sourceTitle: 'On My Mac',
  sourceKind: 'local',
  color: '#336699',
  subscribed: false,
  writable: true,
  ownership: 'mine',
};

function helperEvent(title: string, from: number, to: number): HelperEvent {
  return {
    id: title,
    uid: title,
    start: new Date(NOW + from * MINUTE).toISOString(),
    end: new Date(NOW + to * MINUTE).toISOString(),
    allDay: false,
    title,
    calendarId: WORK.id,
    url: null,
    location: null,
    noteLinks: [],
    hasNotes: false,
    attendeeCount: 2,
    othersInvited: true,
    myStatus: 'accepted',
    availability: 'busy',
    recurring: false,
  };
}

let t: TestDb;
let events: HelperEvent[];
let now: number;
let ticker: CalendarTicker;
const push = { meeting: vi.fn(), release: vi.fn() };
let changed: () => void;

const host: CalendarHost = {
  onChanged: (listener) => {
    changed = listener;
  },
  request: (async (request: CalendarHostRequest) => {
    if (request.op === 'status') return { helper: 'ready', authorization: 'fullAccess' };
    if (request.op === 'calendars') return { calendars: [WORK] };
    return { events, truncated: false, from: '2026-10-15T00:00:00Z', to: '2026-10-24T00:00:00Z' };
  }) as CalendarHost['request'],
};

beforeEach(async () => {
  t = await createTestDb();
  push.meeting.mockReset();
  push.release.mockReset();
  now = NOW;
  events = [helperEvent('Focus: deep', -10, 20), helperEvent('Standup', 8, 23)];
  await setConnected(t.db, t.workspaceId, true);
  await syncCalendars({ db: t.db, workspaceId: t.workspaceId, host });
  const [work] = await savedChoices(t.db, t.workspaceId);
  await updateChoice(t.db, t.workspaceId, work!.key, { nudges: true });
  ticker = startCalendarTicker({
    google: null,
    db: t.db,
    workspaceId: t.workspaceId,
    host,
    push,
    now: () => now,
    tickMs: 3_600_000,
  });
});

afterEach(async () => {
  ticker.stop();
  await t.cleanup();
});

describe('the calendar ticker', () => {
  it('holds during a focus block and releases held pushes when it ends', async () => {
    await ticker.tick();
    expect(ticker.held()).toBe(true);
    expect(push.release).not.toHaveBeenCalled();
    now = NOW + 21 * MINUTE;
    await ticker.tick();
    expect(ticker.held()).toBe(false);
    expect(push.release).toHaveBeenCalledTimes(1);
  });

  it('sends the meeting alert once, only with the switch on and once a hold has ended', async () => {
    await ticker.tick();
    expect(push.meeting).not.toHaveBeenCalled();
    await updateSettings(t.db, t.workspaceId, { phoneAlerts: true });
    await ticker.tick();
    expect(ticker.held()).toBe(true);
    expect(push.meeting).not.toHaveBeenCalled();
    events = [helperEvent('Standup', 8, 23)];
    now = NOW + MINUTE;
    await ticker.tick();
    await ticker.tick();
    expect(push.meeting).toHaveBeenCalledTimes(1);
    expect(push.meeting).toHaveBeenCalledWith(10);
  });

  it('sends one meeting alert for meetings that start together', async () => {
    await updateSettings(t.db, t.workspaceId, { phoneAlerts: true });
    events = [
      helperEvent('Standup', 8, 23),
      helperEvent('Design sync', 8, 38),
      helperEvent('Office hours', 9, 30),
      helperEvent('Planning', 30, 60),
    ];
    await ticker.tick();
    expect(push.meeting).toHaveBeenCalledTimes(1);
    now = NOW + 21 * MINUTE;
    await ticker.tick();
    expect(push.meeting).toHaveBeenCalledTimes(2);
  });

  it('keeps a clashing meeting that comes due a few minutes later in the same alert', async () => {
    await updateSettings(t.db, t.workspaceId, { phoneAlerts: true });
    events = [helperEvent('Standup', 8, 23), helperEvent('Design sync', 12, 40)];
    await ticker.tick();
    expect(push.meeting).toHaveBeenCalledTimes(1);
    now = NOW + 3 * MINUTE;
    await ticker.tick();
    expect(push.meeting).toHaveBeenCalledTimes(1);
  });

  it('sends nothing for a meeting that has started', async () => {
    await updateSettings(t.db, t.workspaceId, { phoneAlerts: true });
    events = [helperEvent('Late', -1, 20)];
    await ticker.tick();
    expect(push.meeting).not.toHaveBeenCalled();
  });

  it('keeps choices when two syncs run at once', async () => {
    const before = await savedChoices(t.db, t.workspaceId);
    const deps = { db: t.db, workspaceId: t.workspaceId, host };
    await t.db.query('DELETE FROM calendar_calendars WHERE workspace_id = $1', [t.workspaceId]);
    await Promise.all([syncCalendars(deps), syncCalendars(deps), syncCalendars(deps)]);
    const after = await savedChoices(t.db, t.workspaceId);
    expect(after).toHaveLength(1);
    expect(before).toHaveLength(1);
  });

  it('checks again when the calendar changes', async () => {
    const spy = vi.spyOn(host, 'request');
    changed();
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    spy.mockRestore();
  });
});

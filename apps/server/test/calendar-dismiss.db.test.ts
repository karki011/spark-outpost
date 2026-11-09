import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calendarDaySchema,
  calendarNowSchema,
  calendarRefreshSchema,
  calendarStatusSchema,
  type CalendarEvent,
} from '@spark-outpost/contracts';
import { createApp } from '../src/api/app.ts';
import { calendarMarks, MARK_PURGE_MS, setMark } from '../src/calendar/store.ts';
import { localClient, testAppOptions } from './app-support.ts';
import { fakeHost, helperEvent, MINUTE, type FakeHost } from './calendar-host-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let host: FakeHost;
let client: ReturnType<typeof localClient>;

function tenThisMorning(): Date {
  const morning = new Date();
  morning.setHours(10, 0, 0, 0);
  return morning;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: tenThisMorning() });
  t = await createTestDb();
  host = fakeHost();
  host.events = [
    helperEvent('Daily', 'work-1', 4, { uid: 'daily@google.com' }),
    helperEvent('Daily later', 'work-1', 240, { uid: 'daily@google.com' }),
  ];
  client = localClient(createApp({ ...testAppOptions(t), calendarHost: host }));
  const connected = await client.send('post', '/api/calendar/connect');
  const work = calendarStatusSchema.parse(connected.body).accounts[0]!.calendars[0]!;
  await client.send('patch', `/api/calendar/calendars/${work.key}`, { nudges: true });
});

afterEach(async () => {
  vi.useRealTimers();
  await t.cleanup();
});

async function events(): Promise<CalendarEvent[]> {
  return calendarDaySchema.parse((await client.get('/api/calendar/day')).body).events;
}

async function now() {
  return calendarNowSchema.parse((await client.get('/api/calendar/now')).body);
}

function dismiss(event: CalendarEvent, on = true) {
  return client.send('put', '/api/calendar/marks', {
    eventKey: event.key,
    end: event.end,
    kind: 'dismiss',
    on,
  });
}

describe('dismissing a meeting alert', () => {
  it('keeps one occurrence quiet and lets the next occurrence of the same meeting alert', async () => {
    const [first, second] = await events();
    expect(first?.key).toMatch(/^daily@google\.com@/);
    expect((await now()).nudge).toMatchObject({ kind: 'before', eventKey: first!.key });
    expect((await dismiss(first!)).status).toBe(200);
    expect((await dismiss(first!)).status).toBe(200);
    const after = await events();
    expect(after.find((event) => event.key === first!.key)?.dismissed).toBe(true);
    expect(after.find((event) => event.key === second!.key)?.dismissed).toBe(false);
    expect((await now()).nudge).toBeNull();
    expect((await t.db.query("SELECT 1 FROM calendar_marks WHERE kind = 'dismiss'")).rowCount).toBe(
      1,
    );
    vi.setSystemTime(Date.parse(second!.start) - 2 * MINUTE);
    expect((await now()).nudge).toMatchObject({ kind: 'before', eventKey: second!.key });
  });

  it('is not a Remind me mark, and Disconnect forgets it', async () => {
    const [first] = await events();
    await dismiss(first!);
    expect((await events())[0]).toMatchObject({ remind: false, hold: false, dismissed: true });
    await client.send('post', '/api/calendar/disconnect');
    expect((await t.db.query('SELECT 1 FROM calendar_marks')).rowCount).toBe(0);
  });

  it('purges the mark an hour after the meeting ends', async () => {
    const [first] = await events();
    await setMark(t.db, t.workspaceId, {
      eventKey: first!.key,
      end: first!.end,
      kind: 'dismiss',
      on: true,
    });
    const end = Date.parse(first!.end);
    const kept = await calendarMarks(t.db, t.workspaceId, new Date(end + MARK_PURGE_MS - 1));
    expect(kept.dismissed.has(first!.key)).toBe(true);
    const purged = await calendarMarks(t.db, t.workspaceId, new Date(end + MARK_PURGE_MS + 1));
    expect(purged.dismissed.size).toBe(0);
  });
});

describe('Join at start', () => {
  function joinAtStart(event: CalendarEvent, on: boolean) {
    return client.send('put', '/api/calendar/marks', {
      eventKey: event.key,
      end: event.end,
      kind: 'join_at_start',
      on,
    });
  }

  it('saves the request on that occurrence, keeps it quiet until the start and cancels', async () => {
    const [first, second] = await events();
    expect((await joinAtStart(first!, true)).status).toBe(200);
    const after = await events();
    expect(after.find((event) => event.key === first!.key)).toMatchObject({
      joinAtStart: true,
      dismissed: false,
    });
    expect(after.find((event) => event.key === second!.key)?.joinAtStart).toBe(false);
    expect((await now()).nudge).toBeNull();
    vi.setSystemTime(Date.parse(first!.start));
    expect((await now()).nudge).toMatchObject({ kind: 'before', eventKey: first!.key });
    expect((await joinAtStart(first!, false)).status).toBe(200);
    expect((await events()).find((event) => event.key === first!.key)?.joinAtStart).toBe(false);
  });

  it('is purged with the other marks and forgotten on Disconnect', async () => {
    const [first] = await events();
    await joinAtStart(first!, true);
    const end = Date.parse(first!.end);
    const purged = await calendarMarks(t.db, t.workspaceId, new Date(end + MARK_PURGE_MS + 1));
    expect(purged.joinAtStart.size).toBe(0);
    await joinAtStart(first!, true);
    await client.send('post', '/api/calendar/disconnect');
    expect((await t.db.query('SELECT 1 FROM calendar_marks')).rowCount).toBe(0);
  });
});

describe('Refresh now', () => {
  it('re-reads macOS Calendar and says when', async () => {
    const response = await client.send('post', '/api/calendar/refresh');
    expect(response.status).toBe(200);
    expect(calendarRefreshSchema.parse(response.body).refreshedAt).toBe(
      tenThisMorning().toISOString(),
    );
    expect(host.calls).toContain('refresh');
  });

  it('does not ask a calendar the user never connected', async () => {
    await client.send('post', '/api/calendar/disconnect');
    host.calls.length = 0;
    expect((await client.send('post', '/api/calendar/refresh')).status).toBe(200);
    expect(host.calls).not.toContain('refresh');
  });
});

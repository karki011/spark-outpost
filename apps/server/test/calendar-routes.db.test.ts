import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calendarDaySchema,
  calendarNowSchema,
  calendarStatusSchema,
} from '@spark-outpost/contracts';
import { createApp } from '../src/api/app.ts';
import { localClient, testAppOptions } from './app-support.ts';
import { fakeHost, helperCalendar, helperEvent, type FakeHost } from './calendar-host-support.ts';
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
  client = localClient(createApp({ ...testAppOptions(t), calendarHost: host }));
});

afterEach(async () => {
  vi.useRealTimers();
  await t.cleanup();
});

async function status() {
  const response = await client.get('/api/calendar/status');
  expect(response.status).toBe(200);
  return calendarStatusSchema.parse(response.body);
}

async function connect() {
  const response = await client.send('post', '/api/calendar/connect');
  expect(response.status).toBe(200);
  return calendarStatusSchema.parse(response.body);
}

describe('calendar status and connect', () => {
  it('is not connected until the user connects, and reads nothing before', async () => {
    const before = await status();
    expect(before).toMatchObject({
      supported: true,
      connected: false,
      authorization: 'notDetermined',
    });
    expect(before.accounts).toEqual([]);
    expect(host.calls).not.toContain('calendars');
    const now = calendarNowSchema.parse((await client.get('/api/calendar/now')).body);
    expect(now).toMatchObject({ active: false, nudge: null, upcoming: [] });
    expect(host.calls).not.toContain('window');
  });

  it('connects after full access, with new calendars included and nudging', async () => {
    const after = await connect();
    expect(after.connected).toBe(true);
    expect(after.accounts.map((account) => account.title)).toEqual(['On My Mac', 'iCloud']);
    expect(after.accounts.flatMap((account) => account.calendars)).toEqual([
      expect.objectContaining({ title: 'Work', include: true, nudges: true }),
      expect.objectContaining({ title: 'Family', include: true, nudges: true }),
    ]);
  });

  it('stays unconnected when the user denies, and shows the denial', async () => {
    host.grant = 'denied';
    const after = await connect();
    expect(after).toMatchObject({ connected: false, authorization: 'denied' });
  });

  it('reports a missing helper', async () => {
    host.helper = 'missing';
    expect(await status()).toMatchObject({ helper: 'missing', authorization: null });
  });

  it('says it is not supported without the Mac app', async () => {
    const plain = localClient(createApp(testAppOptions(t)));
    const response = await plain.get('/api/calendar/status');
    expect(calendarStatusSchema.parse(response.body)).toMatchObject({ supported: false });
    expect((await plain.send('post', '/api/calendar/connect')).status).toBe(503);
  });

  it('keeps choices after a full sync changes the identifier, and disconnect keeps them', async () => {
    const first = await connect();
    const work = first.accounts[0]!.calendars[0]!;
    const patched = await client.send('patch', `/api/calendar/calendars/${work.key}`, {
      nudges: true,
    });
    expect(patched.status).toBe(200);
    host.calendars = [helperCalendar('work-2', 'Work', 'On My Mac'), host.calendars[1]!];
    const resynced = await status();
    expect(resynced.accounts[0]!.calendars[0]).toMatchObject({
      key: work.key,
      calendarId: 'work-2',
      nudges: true,
    });
    await client.send('post', '/api/calendar/disconnect');
    expect(host.calls).toContain('stop');
    const reconnected = await connect();
    expect(reconnected.accounts[0]!.calendars[0]).toMatchObject({ key: work.key, nudges: true });
  });

  it('notes a calendar whose choices were reset', async () => {
    await connect();
    host.calendars = [host.calendars[1]!];
    const after = await status();
    expect(after.notice).toBe(
      'Work (On My Mac) was not found after a calendar sync, so its choices were reset.',
    );
  });

  it('refuses unknown calendars and bad patches', async () => {
    await connect();
    const unknown = await client.send('patch', '/api/calendar/calendars/nope', { include: false });
    expect(unknown.status).toBe(400);
    const status400 = await client.send('patch', '/api/calendar/settings', { busy: true });
    expect(status400.status).toBe(400);
  });

  it('saves Let agents read my calendar, on by default, and Agents can edit per calendar', async () => {
    const connected = await connect();
    expect(connected.settings.agentsRead).toBe(true);
    const off = await client.send('patch', '/api/calendar/settings', { agentsRead: false });
    expect(off.body).toMatchObject({ agentsRead: false });
    expect((await status()).settings.agentsRead).toBe(false);
    const saved = await client.send('patch', '/api/calendar/settings', { agentsRead: true });
    expect(saved.body).toMatchObject({ agentsRead: true });
    const work = connected.accounts[0]!.calendars[0]!;
    expect(work.agentsEdit).toBe(false);
    await client.send('patch', `/api/calendar/calendars/${work.key}`, { agentsEdit: true });
    host.calendars = [helperCalendar('work-2', 'Work', 'On My Mac'), host.calendars[1]!];
    const resynced = await status();
    expect(resynced.accounts[0]!.calendars[0]).toMatchObject({
      key: work.key,
      calendarId: 'work-2',
      agentsEdit: true,
    });
    expect(resynced.settings.agentsRead).toBe(true);
  });
});

describe('the day, the planner and marks', () => {
  beforeEach(async () => {
    host.events = [
      helperEvent('Standup', 'work-1', 4, { uid: 'shared' }),
      helperEvent('Standup copy', 'fam-1', 4, { uid: 'shared' }),
      helperEvent('Later', 'work-1', 120),
    ];
    const connected = await connect();
    const work = connected.accounts[0]!.calendars[0]!;
    await client.send('patch', `/api/calendar/calendars/${work.key}`, { nudges: true });
  });

  it('serves the merged day with de-duplicated copies', async () => {
    const response = await client.get('/api/calendar/day');
    const day = calendarDaySchema.parse(response.body);
    const titles = day.events.map((event) => event.title);
    expect(titles).toContain('Standup');
    expect(titles).not.toContain('Standup copy');
    expect(day.events.find((event) => event.title === 'Standup')?.also).toHaveLength(1);
    expect(day.week).toHaveLength(7);
    expect((await client.get('/api/calendar/day?date=16-10-2026')).status).toBe(400);
  });

  it('plans the before nudge and the upcoming list', async () => {
    const now = calendarNowSchema.parse((await client.get('/api/calendar/now')).body);
    expect(now.active).toBe(true);
    expect(now.nudge).toMatchObject({ kind: 'before', title: 'Standup' });
    expect(now.upcoming.map((event) => event.title)).toEqual(expect.arrayContaining(['Standup']));
  });

  it('saves Remind me and Hold alerts as Spark marks, and disconnect forgets them', async () => {
    const day = calendarDaySchema.parse((await client.get('/api/calendar/day')).body);
    const later = day.events.find((event) => event.title === 'Later')!;
    const marked = await client.send('put', '/api/calendar/marks', {
      eventKey: later.key,
      end: later.end,
      kind: 'hold',
      on: true,
    });
    expect(marked.status).toBe(200);
    const again = calendarDaySchema.parse((await client.get('/api/calendar/day')).body);
    expect(again.events.find((event) => event.key === later.key)?.hold).toBe(true);
    await client.send('post', '/api/calendar/disconnect');
    const rows = await t.db.query('SELECT 1 FROM calendar_marks');
    expect(rows.rowCount).toBe(0);
    const bad = await client.send('put', '/api/calendar/marks', {
      eventKey: 'no-start',
      end: later.end,
      kind: 'hold',
      on: true,
    });
    expect(bad.status).toBe(400);
  });

  it('turns host errors into statuses', async () => {
    const response = await client.send('post', '/api/calendar/event', {
      eventId: 'gone',
      start: new Date().toISOString(),
    });
    expect(response.status).toBe(404);
  });

  it('saves the Notifications settings', async () => {
    const response = await client.send('patch', '/api/calendar/settings', {
      beforeMinutes: 15,
      holdRule: 'meetings',
      focusNames: ['Heads down'],
      phoneAlerts: true,
    });
    expect(response.status).toBe(200);
    expect((await status()).settings).toMatchObject({
      beforeMinutes: 15,
      holdRule: 'meetings',
      focusNames: ['Heads down'],
      phoneAlerts: true,
      agentsRead: true,
    });
  });
});

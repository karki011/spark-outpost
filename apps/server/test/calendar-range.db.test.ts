import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarDaySchema, calendarRangeSchema } from '@spark-outpost/contracts';
import { createApp } from '../src/api/app.ts';
import { dateKey } from '../src/calendar/service.ts';
import { localClient, testAppOptions } from './app-support.ts';
import { fakeHost, helperEvent, MINUTE, type FakeHost } from './calendar-host-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const DAY = 24 * 60 * MINUTE;

let t: TestDb;
let host: FakeHost;
let client: ReturnType<typeof localClient>;

function tenThisMorning(): Date {
  const morning = new Date();
  morning.setHours(10, 0, 0, 0);
  return morning;
}

function dayKey(daysFromToday: number): string {
  const day = new Date();
  day.setDate(day.getDate() + daysFromToday);
  return dateKey(day.getTime());
}

async function range(from: string, to: string) {
  return client.get(`/api/calendar/range?from=${from}&to=${to}`);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: tenThisMorning() });
  t = await createTestDb();
  host = fakeHost();
  client = localClient(createApp({ ...testAppOptions(t), calendarHost: host }));
  host.events = [
    helperEvent('Standup', 'work-1', 30, { uid: 'shared' }),
    helperEvent('Standup copy', 'fam-1', 30, { uid: 'shared' }),
    helperEvent('Last month', 'work-1', -20 * 24 * 60),
    helperEvent('Next month', 'work-1', 25 * 24 * 60),
  ];
  expect((await client.send('post', '/api/calendar/connect')).status).toBe(200);
});

afterEach(async () => {
  vi.useRealTimers();
  await t.cleanup();
});

describe('the calendar range', () => {
  it('serves a month and its padding, merged and sorted, past events included', async () => {
    const response = await range(dayKey(-21), dayKey(28));
    expect(response.status).toBe(200);
    const body = calendarRangeSchema.parse(response.body);
    expect(body.events.map((event) => event.title)).toEqual([
      'Last month',
      'Standup',
      'Next month',
    ]);
    expect(body.events[1]!.also).toHaveLength(1);
    expect(body).toMatchObject({ from: dayKey(-21), to: dayKey(28), today: dayKey(0) });
    expect(body.calendars.map((calendar) => calendar.title)).toEqual(['Work', 'Family']);
    expect(host.ranges).toEqual([
      {
        from: new Date(Date.parse(`${dayKey(-21)}T00:00:00`)).toISOString(),
        to: new Date(Date.parse(`${dayKey(28)}T00:00:00`)).toISOString(),
      },
    ]);
  });

  it('reads the stored window, not the helper, for a range inside it', async () => {
    const response = await range(dayKey(0), dayKey(2));
    expect(calendarRangeSchema.parse(response.body).events.map((event) => event.title)).toEqual([
      'Standup',
    ]);
    expect(host.ranges).toEqual([]);
  });

  it('refuses bad dates, a reversed range and one longer than 62 days', async () => {
    expect((await range('2026-13-01', dayKey(1))).status).toBe(400);
    expect((await range(dayKey(3), dayKey(1))).status).toBe(400);
    expect((await range(dayKey(0), dayKey(0))).status).toBe(400);
    expect((await range(dayKey(0), dayKey(63))).status).toBe(400);
    expect((await range(dayKey(0), dayKey(62))).status).toBe(200);
    expect((await client.get('/api/calendar/range')).status).toBe(400);
  });

  it('shows a day outside the stored window from the helper, keeping this week', async () => {
    const response = await client.get(`/api/calendar/day?date=${dayKey(25)}`);
    const day = calendarDaySchema.parse(response.body);
    expect(day.events.map((event) => event.title)).toEqual(['Next month']);
    expect(day.week[0]!.date).toBe(dayKey(0));
    expect(day.week[0]!.meetings).toBe(1);
    expect(host.ranges).toHaveLength(1);
    expect(Date.parse(host.ranges[0]!.to) - Date.parse(host.ranges[0]!.from)).toBeLessThan(
      DAY + 2 * 60 * MINUTE,
    );
  });
});

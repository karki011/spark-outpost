import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calendarDaySchema,
  calendarEventDetailSchema,
  calendarRangeSchema,
} from '@spark-outpost/contracts';
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

function midnight(daysFromToday: number): string {
  return new Date(Date.parse(`${dayKey(daysFromToday)}T00:00:00`)).toISOString();
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

  it('refuses bad dates, a reversed range and one longer than 62 days', async () => {
    expect((await range('2026-13-01', '2027-01-15')).status).toBe(400);
    expect((await range('2026-02-01', '2026-02-30')).status).toBe(400);
    expect((await range(dayKey(3), dayKey(1))).status).toBe(400);
    expect((await range(dayKey(0), dayKey(0))).status).toBe(400);
    expect((await range(dayKey(0), dayKey(63))).status).toBe(400);
    expect((await range(dayKey(0), dayKey(62))).status).toBe(200);
    expect((await client.get('/api/calendar/range')).status).toBe(400);
  });

  it('reads a far day and this week as two short spans', async () => {
    const response = await client.get(`/api/calendar/day?date=${dayKey(25)}`);
    const day = calendarDaySchema.parse(response.body);
    expect(day.events.map((event) => event.title)).toEqual(['Next month']);
    expect(day.week[0]!.date).toBe(dayKey(0));
    expect(day.week[0]!.meetings).toBe(1);
    expect(host.ranges).toEqual([
      { from: midnight(25), to: midnight(26) },
      { from: midnight(0), to: midnight(7) },
    ]);
    expect((await client.get('/api/calendar/day?date=16-10-2026')).status).toBe(400);
  });

  it('finds a day eight months out past more than 2,000 events in between', async () => {
    const busy = Array.from({ length: 2_500 }, (_, index) =>
      helperEvent(`Busy ${index}`, 'work-1', 24 * 60 + index * 120),
    );
    host.events = [...busy, helperEvent('Far meeting', 'work-1', 240 * 24 * 60 + 60)];
    const response = await client.get(`/api/calendar/day?date=${dayKey(240)}`);
    const day = calendarDaySchema.parse(response.body);
    expect(day.events.map((event) => event.title)).toEqual(['Far meeting']);
    expect(day.truncated).toBe(false);
    for (const span of host.ranges) {
      expect(Date.parse(span.to) - Date.parse(span.from)).toBeLessThanOrEqual(8 * DAY);
    }
  });

  it('keeps Mac attendee names to 300 characters and leaves out the user', async () => {
    const [event] = host.events;
    host.detail = {
      event: event!,
      notes: '',
      attendees: [
        { name: 'Me', isMe: true, status: 'accepted' },
        { name: 'A'.repeat(400), isMe: false, status: 'accepted' },
      ],
      organizerIsMe: false,
    };
    const response = await client.send('post', '/api/calendar/event', {
      eventId: event!.id,
      start: event!.start,
    });
    const detail = calendarEventDetailSchema.parse(response.body);
    expect(detail.attendees).toEqual(['A'.repeat(300)]);
  });
});

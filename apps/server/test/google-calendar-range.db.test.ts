import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { calendarEventDetailSchema, calendarRangeSchema } from '@spark-outpost/contracts';
import { dateKey } from '../src/calendar/service.ts';
import {
  EMAIL,
  MINUTE,
  SUBJECT,
  googleHarness,
  meeting,
  signIn,
  type Harness,
} from './google-calendar-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const DAY_MINUTES = 24 * 60;

let t: TestDb;
let h: Harness;

beforeEach(async () => {
  t = await createTestDb();
  h = googleHarness(t);
});

afterEach(async () => {
  h.google.stop();
  await t.cleanup();
});

function dayKey(daysFromToday: number): string {
  return dateKey(Date.now() + daysFromToday * DAY_MINUTES * MINUTE);
}

const eventCalls = () => h.fake.requests.filter((request) => request.path.endsWith('/events'));

async function range(from: string, to: string) {
  const response = await h.client.get(`/api/calendar/range?from=${from}&to=${to}`);
  expect(response.status).toBe(200);
  return calendarRangeSchema.parse(response.body);
}

describe('a Google range outside the synced window', () => {
  beforeEach(async () => {
    h.fake.putEvent(SUBJECT, EMAIL, meeting('today', 0));
    h.fake.putEvent(
      SUBJECT,
      EMAIL,
      meeting('planning', 20 * DAY_MINUTES, {
        description: 'Agenda<br>Join: https://meet.google.com/abc-defg-hij',
        htmlLink: 'https://www.google.com/calendar/event?eid=plan',
        attendees: [
          { self: true, email: EMAIL },
          { displayName: 'Alex Wong', email: 'alex@example.com' },
          { email: 'ivan@example.com' },
          { resource: true, displayName: 'Room 4' },
        ],
      }),
    );
    await signIn(h);
  });

  it('reads it once with timeMin and timeMax, keeps it for a while, and never touches the sync token', async () => {
    const before = eventCalls().length;
    const month = await range(dayKey(-7), dayKey(35));
    expect(month.events.map((event) => event.title)).toEqual(['today', 'planning']);
    const fetched = eventCalls().slice(before);
    expect(fetched).toHaveLength(1);
    expect(fetched[0]!.query).toMatchObject({ singleEvents: 'true' });
    expect(fetched[0]!.query.timeMin).toBeDefined();
    expect(fetched[0]!.query.syncToken).toBeUndefined();

    await range(dayKey(-7), dayKey(35));
    expect(eventCalls().length - before).toBe(1);

    await h.google.syncNow();
    const synced = eventCalls().at(-1)!;
    expect(synced.query.syncToken).toBeDefined();
  });

  it('fetches the details of an event outside the synced window by id, with attendee names', async () => {
    const month = await range(dayKey(-7), dayKey(35));
    const planning = month.events.find((event) => event.title === 'planning')!;
    const before = h.fake.requests.length;
    const response = await h.client.send('post', '/api/calendar/event', {
      eventId: planning.id,
      start: planning.start,
    });
    expect(response.status).toBe(200);
    expect(calendarEventDetailSchema.parse(response.body)).toEqual({
      title: 'planning',
      notes: 'Agenda\nJoin: https://meet.google.com/abc-defg-hij',
      snippet: 'Agenda Join:',
      link: 'https://www.google.com/calendar/event?eid=plan',
      attendees: ['Alex Wong', 'ivan@example.com'],
    });
    expect(h.fake.requests.slice(before).map((request) => request.path)).toContain(
      `/calendar/v3/calendars/${encodeURIComponent(EMAIL)}/events/planning`,
    );
  });
});

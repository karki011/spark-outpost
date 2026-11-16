import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calendarDaySchema,
  calendarNowSchema,
  calendarStatusSchema,
} from '@spark-outpost/contracts';
import { createApp } from '../src/api/app.ts';
import { localClient, testAppOptions } from './app-support.ts';
import { fakeHost, helperEvent, MINUTE } from './calendar-host-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let client: ReturnType<typeof localClient>;

beforeEach(async () => {
  const morning = new Date();
  morning.setHours(10, 0, 0, 0);
  vi.useFakeTimers({ toFake: ['Date'], now: morning });
  t = await createTestDb();
  const host = fakeHost();
  host.events = [
    helperEvent('Recorded', 'work-1', -20),
    helperEvent('Not recorded', 'work-1', -19),
  ];
  client = localClient(createApp({ ...testAppOptions(t), calendarHost: host }));
  await client.send('post', '/api/calendar/connect');
  const status = calendarStatusSchema.parse((await client.get('/api/calendar/status')).body);
  const work = status.accounts[0]!.calendars[0]!;
  await client.send('patch', `/api/calendar/calendars/${work.key}`, { nudges: true });
});

afterEach(async () => {
  vi.useRealTimers();
  await t.cleanup();
});

async function eventKey(title: string): Promise<string> {
  const day = calendarDaySchema.parse((await client.get('/api/calendar/day')).body);
  return day.events.find((event) => event.title === title)!.key;
}

async function recorded(key: string, lines: number, state = 'ended') {
  const id = randomUUID();
  await t.db.query(
    `INSERT INTO meetings (id, workspace_id, title, source, event_key, started_at, ended_at, state, line_count)
     VALUES ($1, $2, 'Recorded', 'calendar', $3, $4, $5, $6, $7)`,
    [
      id,
      t.workspaceId,
      key,
      new Date(Date.now() - 20 * MINUTE),
      state === 'recording' ? null : new Date(Date.now() - 4 * MINUTE),
      state,
      lines,
    ],
  );
  return id;
}

async function capture() {
  return calendarNowSchema.parse((await client.get('/api/calendar/now')).body).capture;
}

describe('Anything to capture?', () => {
  it('offers only a meeting Spark took notes in, and opens those notes', async () => {
    expect(await capture()).toBeNull();
    const id = await recorded(await eventKey('Recorded'), 12);
    expect(await capture()).toEqual({
      eventKey: await eventKey('Recorded'),
      meetingId: id,
      title: 'Recorded',
    });
  });

  it('skips a recording with no words and one still recording', async () => {
    await recorded(await eventKey('Recorded'), 0);
    expect(await capture()).toBeNull();
    await recorded(await eventKey('Not recorded'), 5, 'recording');
    expect(await capture()).toBeNull();
  });

  it('stops offering 15 min after the notes stopped', async () => {
    await recorded(await eventKey('Recorded'), 12);
    vi.setSystemTime(Date.now() + 12 * MINUTE);
    expect(await capture()).toBeNull();
  });
});

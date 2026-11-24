import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GOOGLE_REPLY_NEEDS_GRANT, googleSignInFlowSchema } from '@spark-outpost/contracts';
import {
  EMAIL,
  googleHarness,
  noon,
  signIn,
  status,
  today,
  type Harness,
} from './google-calendar-support.ts';
import { createTestDb, type TestDb } from './support.ts';

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

async function allowEdits() {
  const accountId = (await status(h)).google.accounts[0]!.id;
  const started = await h.client.send('post', '/api/calendar/google/sign-in', {
    accountId,
    replies: true,
  });
  const flow = googleSignInFlowSchema.parse(started.body);
  await fetch(h.fake.authorize(flow.authorizeUrl!));
  await h.google.signInSettled();
  await h.google.syncNow();
}

async function request(overrides: object = {}) {
  const calendarKey = (await status(h)).accounts[0]!.calendars[0]!.key!;
  return {
    calendarKey,
    title: 'Launch review',
    start: noon(60),
    end: noon(90),
    guests: [],
    meet: false,
    location: '',
    notes: '',
    ...overrides,
  };
}

const lastInsert = () =>
  h.fake.requests.filter((item) => item.method === 'POST' && item.path.endsWith('/events')).at(-1);

describe('Creating a Google event', () => {
  it('is refused until the account allows changes, and writes nothing', async () => {
    await signIn(h);
    const refused = await h.client.send('post', '/api/calendar/events', await request());
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).toContain(GOOGLE_REPLY_NEEDS_GRANT);
    expect(h.fake.writes).toEqual([]);
  });

  it('creates an event without guests quietly and shows it on the day', async () => {
    await signIn(h);
    await allowEdits();
    const created = await h.client.send('post', '/api/calendar/events', await request());
    expect(created.status).toBe(200);
    expect(h.fake.writes).toHaveLength(1);
    expect(h.fake.writes[0]).toMatchObject({
      method: 'POST',
      calendarId: EMAIL,
      sendUpdates: 'none',
    });
    expect(h.fake.writes[0]!.body).toEqual({
      summary: 'Launch review',
      start: { dateTime: noon(60) },
      end: { dateTime: noon(90) },
    });
    expect(lastInsert()!.query).not.toHaveProperty('conferenceDataVersion');
    expect((await today(h)).events.map((event) => event.title)).toContain('Launch review');
  });

  it('invites guests with a Meet link and tells them', async () => {
    await signIn(h);
    await allowEdits();
    const created = await h.client.send(
      'post',
      '/api/calendar/events',
      await request({
        guests: ['ana@example.com', 'ivan@example.com'],
        meet: true,
        location: ' Room 4 ',
        notes: 'Agenda to follow.',
      }),
    );
    expect(created.status).toBe(200);
    const write = h.fake.writes[0]!;
    expect(write.sendUpdates).toBe('all');
    expect(write.body).toMatchObject({
      attendees: [{ email: 'ana@example.com' }, { email: 'ivan@example.com' }],
      location: 'Room 4',
      description: 'Agenda to follow.',
      conferenceData: { createRequest: { conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    });
    expect(lastInsert()!.query.conferenceDataVersion).toBe('1');
  });

  it('refuses an end before the start, a bad guest address and an unknown calendar', async () => {
    await signIn(h);
    await allowEdits();
    const backwards = await request({ start: noon(90), end: noon(60) });
    const badGuest = await request({ guests: ['not-an-address'] });
    const unknown = await request({ calendarKey: '00000000-0000-4000-8000-000000000000' });
    for (const body of [backwards, badGuest, unknown]) {
      const answer = await h.client.send('post', '/api/calendar/events', body);
      expect(answer.status).toBe(400);
    }
    expect(h.fake.writes).toEqual([]);
  });
});

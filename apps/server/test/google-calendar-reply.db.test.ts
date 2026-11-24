import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GOOGLE_EVENTS_EDIT_SCOPE,
  GOOGLE_REPLY_NEEDS_GRANT,
  googleSignInFlowSchema,
} from '@spark-outpost/contracts';
import {
  EMAIL,
  SUBJECT,
  googleHarness,
  meeting,
  signIn,
  status,
  today,
  type Harness,
} from './google-calendar-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let h: Harness;

const GUESTS = [
  { email: EMAIL, self: true, responseStatus: 'needsAction', comment: 'kept' },
  { email: 'ana@example.com', displayName: 'Ana', responseStatus: 'accepted', optional: true },
];

beforeEach(async () => {
  t = await createTestDb();
  h = googleHarness(t);
  h.fake.putEvent(SUBJECT, EMAIL, meeting('planning', 60, { attendees: GUESTS }));
});

afterEach(async () => {
  h.google.stop();
  await t.cleanup();
});

async function planning() {
  const event = (await today(h)).events.find((item) => item.title === 'planning')!;
  const calendarKey = (await status(h)).accounts[0]!.calendars[0]!.key!;
  return { eventId: event.id, start: event.start, calendarKey, myStatus: event.myStatus };
}

async function allowReplies(accountId: string) {
  const started = await h.client.send('post', '/api/calendar/google/sign-in', {
    accountId,
    replies: true,
  });
  const flow = googleSignInFlowSchema.parse(started.body);
  expect(new URL(flow.authorizeUrl!).searchParams.get('scope')!.split(' ')).toContain(
    GOOGLE_EVENTS_EDIT_SCOPE,
  );
  await fetch(h.fake.authorize(flow.authorizeUrl!));
  await h.google.signInSettled();
  await h.google.syncNow();
}

describe('Replying to a Google invitation', () => {
  it('is refused until the account allows replies, and writes nothing', async () => {
    await signIn(h);
    const { myStatus, ...occurrence } = await planning();
    expect(myStatus).toBe('pending');
    const refused = await h.client.send('post', '/api/calendar/reply', {
      ...occurrence,
      reply: 'accepted',
    });
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).toContain(GOOGLE_REPLY_NEEDS_GRANT);
    expect(h.fake.writes).toEqual([]);
  });

  it('changes only the user’s own reply, tells the guests and shows the new reply', async () => {
    await signIn(h);
    const account = (await status(h)).google.accounts[0]!;
    await allowReplies(account.id);
    const after = await status(h);
    expect(after.google.accounts[0]!.canEdit).toBe(true);
    expect(after.accounts[0]!.calendars[0]!.agentsEdit).toBe(false);
    const invited = await planning();
    const occurrence = {
      eventId: invited.eventId,
      start: invited.start,
      calendarKey: invited.calendarKey,
    };
    const sent = await h.client.send('post', '/api/calendar/reply', {
      ...occurrence,
      reply: 'tentative',
    });
    expect(sent.status).toBe(200);
    expect(h.fake.writes).toHaveLength(1);
    expect(h.fake.writes[0]).toMatchObject({ method: 'PATCH', sendUpdates: 'all' });
    expect(h.fake.writes[0]!.body).toEqual({
      attendees: [{ ...GUESTS[0], responseStatus: 'tentative' }, GUESTS[1]],
    });
    expect((await planning()).myStatus).toBe('tentative');
    const detail = await h.client.send('post', '/api/calendar/event', occurrence);
    expect(detail.body).toMatchObject({
      attendees: [{ name: 'Ana', email: 'ana@example.com', reply: 'accepted' }],
    });
  });

  it('refuses an event the user is not a guest of and a calendar that is not Google', async () => {
    await signIn(h);
    await allowReplies((await status(h)).google.accounts[0]!.id);
    h.fake.putEvent(SUBJECT, EMAIL, meeting('solo', 120));
    await h.google.syncNow();
    const solo = (await today(h)).events.find((item) => item.title === 'solo')!;
    const { calendarKey } = await planning();
    const notGuest = await h.client.send('post', '/api/calendar/reply', {
      eventId: solo.id,
      start: solo.start,
      calendarKey,
      reply: 'accepted',
    });
    expect(notGuest.status).toBe(502);
    expect(h.fake.writes).toEqual([]);
    const mac = await h.client.send('post', '/api/calendar/reply', {
      eventId: 'ek-1',
      start: solo.start,
      calendarKey,
      reply: 'accepted',
    });
    expect(mac.status).toBe(400);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGoogleAgentClient } from '../src/calendar/agent/google-client.ts';
import { FAKE_GOOGLE_CLIENT_ID, FAKE_GOOGLE_CLIENT_SECRET } from './fake-google-calendar.ts';
import {
  EMAIL,
  SUBJECT,
  googleHarness,
  signIn,
  status,
  type Harness,
} from './google-calendar-support.ts';
import { CalendarHarness, tomorrowAt } from './spark-calendar-support.ts';

let h: CalendarHarness;
let g: Harness;

beforeEach(async () => {
  h = await CalendarHarness.create();
  g = googleHarness(h.t);
});

afterEach(async () => {
  g.google.stop();
  await h.close();
});

async function connectGoogle(mode = 'auto') {
  await signIn(g);
  const connected = await status(g);
  const calendarKey = connected.accounts[0]!.calendars[0]!.key;
  await signIn(g, connected.google.accounts[0]!.id, calendarKey);
  const [account] = (await status(g)).google.accounts;
  const calendarId = `google:${account!.id}:${EMAIL}`;
  await h.start({
    mode,
    edit: ['work-1', calendarId],
    google: createGoogleAgentClient({
      db: h.t.db,
      secrets: g.secrets,
      fetch: g.fake.fetch,
      client: {
        clientId: FAKE_GOOGLE_CLIENT_ID,
        clientSecret: FAKE_GOOGLE_CLIENT_SECRET,
        verified: false,
        accountsUrl: g.fake.baseUrl,
        oauthUrl: g.fake.baseUrl,
        apiUrl: `${g.fake.baseUrl}/calendar/v3`,
      },
    }),
  });
  return { account: account!, key: await h.key(calendarId) };
}

function putInvite() {
  g.fake.putEvent(SUBJECT, EMAIL, {
    id: 'review',
    iCalUID: 'review@google.com',
    summary: 'Design review',
    start: { dateTime: tomorrowAt(14) },
    end: { dateTime: tomorrowAt(15) },
    attendees: [
      { email: 'ana@example.com', responseStatus: 'accepted' },
      { email: EMAIL, self: true, responseStatus: 'needsAction' },
    ],
  });
}

const NEW_EVENT = { title: 'Sync', start: tomorrowAt(15), end: tomorrowAt(16) };

describe('Agent invitations, Meet links and replies on Google', () => {
  it('adds a Meet link at once in Auto and tells no one', async () => {
    const { key } = await connectGoogle();
    const created = await h.edit({ action: 'create', calendar: key, ...NEW_EVENT, meet: true });
    expect(created.facts.outcome).toBe('done');
    expect(String(created.facts.message)).toContain('with a Google Meet link');
    expect(g.fake.writes[0]).toMatchObject({
      method: 'POST',
      sendUpdates: 'none',
      body: {
        conferenceData: { createRequest: { conferenceSolutionKey: { type: 'hangoutsMeet' } } },
      },
    });
    expect(g.fake.writes[0]!.body).not.toHaveProperty('attendees');
  });

  it('asks before inviting guests in Auto, then emails them once confirmed', async () => {
    const { key } = await connectGoogle();
    const inviting = await h.edit({
      action: 'create',
      calendar: key,
      ...NEW_EVENT,
      guests: ['Ana@Example.com', 'ana@example.com', 'bo@example.com'],
    });
    expect(inviting.facts.outcome).toBe('waiting_for_user');
    expect(g.fake.writes).toEqual([]);
    expect((await h.pending()).payload.sparkAction).toMatchObject({
      floor: ['invites'],
      guests: ['ana@example.com', 'bo@example.com'],
    });
    await h.answer('confirm');
    await expect.poll(() => g.fake.writes.length).toBe(1);
    expect(g.fake.writes[0]).toMatchObject({
      method: 'POST',
      sendUpdates: 'all',
      body: { attendees: [{ email: 'ana@example.com' }, { email: 'bo@example.com' }] },
    });
    expect(JSON.stringify(h.recorded.audited)).not.toContain('ana@example.com');
  });

  it('asks before answering an invitation in Auto, then tells Google', async () => {
    putInvite();
    const { account, key } = await connectGoogle();
    const replying = await h.edit({
      action: 'reply',
      calendar: key,
      eventId: `google:${account.id}:review`,
      occurrence: tomorrowAt(14),
      reply: 'accepted',
    });
    expect(replying.facts.outcome).toBe('waiting_for_user');
    expect((await h.pending()).payload.sparkAction).toMatchObject({
      op: 'reply',
      reply: 'accepted',
      floor: ['reply'],
    });
    await h.answer('confirm');
    await expect.poll(() => g.fake.writes.length).toBe(1);
    expect(g.fake.writes[0]).toMatchObject({
      method: 'PATCH',
      eventId: 'review',
      sendUpdates: 'all',
    });
    const attendees = (g.fake.writes[0]!.body as { attendees: { self?: boolean }[] }).attendees;
    expect(attendees.find((attendee) => attendee.self)).toMatchObject({
      responseStatus: 'accepted',
    });
  });

  it('refuses a reply without an answer, and guests or Meet outside a new Google event', async () => {
    putInvite();
    const { account, key } = await connectGoogle();
    const ref = { eventId: `google:${account.id}:review`, occurrence: tomorrowAt(14) };
    const noAnswer = await h.edit({ action: 'reply', calendar: key, ...ref });
    expect(noAnswer.result.isError).toBe(true);
    const onUpdate = await h.edit({
      action: 'update',
      calendar: key,
      ...ref,
      title: 'Renamed',
      guests: ['bo@example.com'],
    });
    expect(onUpdate.text).toContain('new event only');
    const onMac = await h.edit({
      action: 'create',
      calendar: await h.key('work-1'),
      ...NEW_EVENT,
      meet: true,
    });
    expect(onMac.text).toContain('need a Google calendar');
    expect(g.fake.writes).toEqual([]);
  });
});

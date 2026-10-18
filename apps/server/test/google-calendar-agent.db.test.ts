import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GOOGLE_CALENDAR_LIST_SCOPE, GOOGLE_EVENTS_EDIT_SCOPE } from '@spark-outpost/contracts';
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

async function connectGoogle(mode = 'auto', allowEdit = true) {
  await signIn(g);
  const connected = await status(g);
  const calendarKey = connected.accounts[0]!.calendars[0]!.key;
  if (allowEdit) await signIn(g, connected.google.accounts[0]!.id, calendarKey);
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
  return { account: account!, calendarId, key: await h.key(calendarId) };
}

function putReview(extra: object = {}) {
  g.fake.putEvent(SUBJECT, EMAIL, {
    id: 'review',
    iCalUID: 'review@google.com',
    summary: 'Design review',
    start: { dateTime: tomorrowAt(14) },
    end: { dateTime: tomorrowAt(15) },
    ...extra,
  });
}

describe('Google calendars through the agent tools', () => {
  it('reads Google events next to macOS ones', async () => {
    putReview();
    await connectGoogle();
    const read = await h.read();
    const titles = (read.facts.events as { title: string }[]).map((event) => event.title);
    expect(titles).toContain('Design review');
    expect(titles).toContain('Planning');
  });

  it('creates and moves an event through the API without telling anyone', async () => {
    const { key } = await connectGoogle();
    const created = await h.edit({
      action: 'create',
      calendar: key,
      title: 'Spark 1b test',
      start: tomorrowAt(15),
      end: tomorrowAt(16),
      alarmMinutes: 10,
    });
    expect(created.facts.outcome).toBe('done');
    const ref = created.facts.ref as { eventId: string; occurrence: string };
    expect(g.fake.writes[0]).toMatchObject({
      method: 'POST',
      calendarId: EMAIL,
      sendUpdates: 'none',
      body: {
        summary: 'Spark 1b test',
        start: { dateTime: tomorrowAt(15) },
        end: { dateTime: tomorrowAt(16) },
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
      },
    });
    const moved = await h.edit({
      action: 'update',
      calendar: key,
      eventId: ref.eventId,
      occurrence: ref.occurrence,
      start: tomorrowAt(17),
    });
    expect(moved.facts.outcome).toBe('done');
    expect(g.fake.writes[1]).toMatchObject({
      method: 'PATCH',
      eventId: 'created-1',
      sendUpdates: 'none',
      body: { start: { dateTime: tomorrowAt(17) }, end: { dateTime: tomorrowAt(18) } },
    });
  });

  it('flags a write to Google after a read as a send, without the title', async () => {
    const { key } = await connectGoogle();
    await h.read();
    const created = await h.edit({
      action: 'create',
      calendar: key,
      title: 'Secret offsite',
      start: tomorrowAt(15),
      end: tomorrowAt(16),
    });
    expect(created.facts.outcome).toBe('done');
    expect(h.audited('spark/egress')).toEqual([
      expect.objectContaining({
        outcome: 'ran',
        subject: `a change on ${EMAIL}`,
        observed: ['calendar events'],
      }),
    ]);
    expect(JSON.stringify(h.recorded.audited)).not.toContain('Secret offsite');
  });

  it('asks before a delete even in Auto, then deletes', async () => {
    putReview();
    const { account, key } = await connectGoogle();
    const deleting = await h.edit({
      action: 'delete',
      calendar: key,
      eventId: `google:${account.id}:review`,
      occurrence: tomorrowAt(14),
    });
    expect(deleting.facts.outcome).toBe('waiting_for_user');
    expect(g.fake.writes).toEqual([]);
    await h.answer('confirm');
    await expect.poll(() => g.fake.writes.map((write) => write.method)).toEqual(['DELETE']);
    expect(g.fake.eventOf(SUBJECT, EMAIL, 'review')).toBeNull();
  });

  it('asks before changing a Google event with other people', async () => {
    putReview({ attendees: [{ email: 'ana@example.com' }, { email: EMAIL, self: true }] });
    const { account, key } = await connectGoogle();
    const renaming = await h.edit({
      action: 'update',
      calendar: key,
      eventId: `google:${account.id}:review`,
      occurrence: tomorrowAt(14),
      title: 'Design review (moved)',
    });
    expect(renaming.facts.outcome).toBe('waiting_for_user');
    expect((await h.pending()).payload.sparkAction).toMatchObject({ floor: ['others'] });
  });

  it('turns a timed Google event into an all-day one with both dates', async () => {
    putReview();
    const { account, key } = await connectGoogle();
    const changed = await h.edit({
      action: 'update',
      calendar: key,
      eventId: `google:${account.id}:review`,
      occurrence: tomorrowAt(14),
      allDay: true,
    });
    expect(changed.facts.outcome).toBe('done');
    const body = g.fake.writes[0]!.body as { start: { date: string }; end: { date: string } };
    expect(body.start.date).toBeDefined();
    expect(body.end.date > body.start.date).toBe(true);
  });

  it('refuses This and future on Google', async () => {
    putReview({ recurringEventId: 'series' });
    const { account, key } = await connectGoogle();
    const refused = await h.edit({
      action: 'update',
      calendar: key,
      eventId: `google:${account.id}:review`,
      occurrence: tomorrowAt(14),
      span: 'future',
      title: 'x',
    });
    expect(refused.result.isError).toBe(true);
    expect(refused.text).toContain('one occurrence at a time');
  });

  it('refuses writes on an account that has not allowed editing', async () => {
    const { account, key } = await connectGoogle('auto', false);
    expect(account.canEdit).toBe(false);
    const refused = await h.edit({
      action: 'create',
      calendar: key,
      title: 'x',
      start: tomorrowAt(15),
      end: tomorrowAt(16),
    });
    expect(refused.result.isError).toBe(true);
    expect(refused.text).toContain('Agents can edit');
    expect(g.fake.writes).toEqual([]);
    expect((await h.read()).result.isError).toBeFalsy();
  });

  it('counts the editing scope as reading when the read box was left unticked', async () => {
    putReview();
    await signIn(g);
    g.fake.forgetGrants(SUBJECT);
    g.fake.grantedScopes = [
      'openid',
      'email',
      GOOGLE_CALENDAR_LIST_SCOPE,
      GOOGLE_EVENTS_EDIT_SCOPE,
    ];
    const { account } = await connectGoogle();
    expect(account).toMatchObject({ state: 'ready', canEdit: true });
    const titles = ((await h.read()).facts.events as { title: string }[]).map((e) => e.title);
    expect(titles).toContain('Design review');
  });
});

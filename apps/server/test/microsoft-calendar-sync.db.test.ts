import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { calendarEventDetailSchema } from '@spark-outpost/contracts';
import { cloudAccounts } from '../src/calendar/cloud/account-store.ts';
import { microsoftLiveAccount, pollMicrosoftAccount } from '../src/calendar/microsoft/accounts.ts';
import { dateKey } from '../src/calendar/service.ts';
import { FAKE_MICROSOFT_CLIENT_ID } from './fake-microsoft-graph.ts';
import { macCopy, noon } from './google-calendar-support.ts';
import {
  MS_CALENDAR,
  OID,
  graphMeeting,
  microsoftHarness,
  msSignIn,
  msStatus,
  msToday,
  type MicrosoftHarness,
} from './microsoft-calendar-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let h: MicrosoftHarness;

beforeEach(async () => {
  t = await createTestDb();
  h = microsoftHarness(t);
});

afterEach(async () => {
  h.microsoft.stop();
  await t.cleanup();
});

const titles = async () => (await msToday(h)).events.map((event) => event.title);
const deltaCalls = () =>
  h.fake.requests.filter((request) => request.path.endsWith('/calendarView/delta'));
const TEAMS = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0';

describe('Microsoft sync', () => {
  it('reads every page of calendarView/delta in UTC, then follows the delta link', async () => {
    h.fake.putEvent(OID, MS_CALENDAR, graphMeeting('one', 0));
    h.fake.putEvent(OID, MS_CALENDAR, graphMeeting('two', 60));
    h.fake.putEvent(OID, MS_CALENDAR, graphMeeting('three', 120));
    await msSignIn(h);
    expect(await titles()).toEqual(['one', 'two', 'three']);
    const first = deltaCalls();
    expect(first[0]?.query.startDateTime).toBeDefined();
    expect(first.length).toBeGreaterThanOrEqual(2);
    expect(first.every((request) => request.prefer?.includes('outlook.timezone="UTC"'))).toBe(true);

    await h.microsoft.syncNow();
    const last = deltaCalls().at(-1)!;
    expect(last.query.$deltatoken).toBeDefined();
    expect(last.query.startDateTime).toBeUndefined();
  });

  it('applies changes and removals from the delta link', async () => {
    h.fake.putEvent(OID, MS_CALENDAR, graphMeeting('keep', 0));
    h.fake.putEvent(OID, MS_CALENDAR, graphMeeting('drop', 60));
    h.fake.putEvent(OID, MS_CALENDAR, graphMeeting('cancel', 90));
    await msSignIn(h);
    h.fake.putEvent(OID, MS_CALENDAR, graphMeeting('keep', 30, { subject: 'moved' }));
    h.fake.removeEvent(OID, MS_CALENDAR, 'drop');
    h.fake.putEvent(OID, MS_CALENDAR, graphMeeting('cancel', 90, { isCancelled: true }));
    h.fake.putEvent(OID, MS_CALENDAR, graphMeeting('new', 120));
    await h.microsoft.syncNow();
    expect(await titles()).toEqual(['moved', 'new']);
  });

  it('runs a full windowed sync again when Microsoft rejects the delta token (410)', async () => {
    h.fake.putEvent(OID, MS_CALENDAR, graphMeeting('first', 0));
    await msSignIn(h);
    h.fake.expireDeltaTokens();
    h.fake.putEvent(OID, MS_CALENDAR, graphMeeting('after', 60));
    await h.microsoft.syncNow();
    expect(await titles()).toEqual(['first', 'after']);
    const calls = deltaCalls();
    expect(calls.at(-2)?.query.$deltatoken).toBeDefined();
    expect(calls.at(-1)?.query.startDateTime).toBeDefined();
  });

  it('backs off on 429 honouring Retry-After and on 5xx, keeps events, then recovers', async () => {
    h.fake.putEvent(OID, MS_CALENDAR, graphMeeting('kept', 0));
    await msSignIn(h);
    const [row] = await cloudAccounts(t.db, 'microsoft', t.workspaceId);
    const account = microsoftLiveAccount(row!);
    const deps = {
      db: t.db,
      workspaceId: t.workspaceId,
      secrets: h.secrets,
      fetch: h.fake.fetch,
      client: {
        clientId: FAKE_MICROSOFT_CLIENT_ID,
        loginUrl: h.fake.loginUrl,
        graphUrl: h.fake.graphUrl,
      },
      now: Date.now,
    };
    h.fake.failNext('/graph/v1.0/me/calendars', {
      status: 429,
      code: 'TooManyRequests',
      retryAfter: 120,
    });
    const limited = await pollMicrosoftAccount(deps, account, () => 0.5);
    expect(limited.nextInMs).toBe(120_000);
    expect(account).toMatchObject({
      state: 'error',
      message: 'Microsoft asked Spark to slow down. Trying again soon.',
    });
    h.fake.failNext('/graph/v1.0/me/calendars', { status: 503 });
    const busy = await pollMicrosoftAccount(deps, account, () => 0.5);
    expect(busy.nextInMs).toBe(60_000);
    expect((await pollMicrosoftAccount(deps, account, () => 0.5)).nextInMs).toBe(180_000);
    expect(account.state).toBe('ready');

    h.fake.failNext('/graph/v1.0/me/calendars', { status: 429, retryAfter: 5 });
    await h.microsoft.syncNow();
    expect((await msStatus(h)).microsoft.accounts[0]?.state).toBe('error');
    expect(await titles()).toEqual(['kept']);
  });

  it('maps Teams links, all-day events, my answer and the people on a meeting', async () => {
    const date = dateKey(Date.now());
    const tomorrow = dateKey(Date.now() + 24 * 60 * 60_000);
    h.fake.putEvent(
      OID,
      MS_CALENDAR,
      graphMeeting('sync', 0, {
        onlineMeeting: { joinUrl: TEAMS },
        isOrganizer: false,
        responseStatus: { response: 'tentativelyAccepted' },
        organizer: { emailAddress: { name: 'Pat', address: 'pat@contoso.com' } },
        attendees: [
          { type: 'required', emailAddress: { name: 'Owner', address: 'OWNER@contoso.com' } },
          { type: 'resource', emailAddress: { name: 'Room 1', address: 'room1@contoso.com' } },
        ],
        body: { contentType: 'html', content: '<p>Agenda</p>' },
        webLink: 'https://outlook.office365.com/owa/?itemid=AAMk&exvsurl=1',
      }),
    );
    h.fake.putEvent(
      OID,
      MS_CALENDAR,
      graphMeeting('Holiday', 0, {
        isAllDay: true,
        showAs: 'free',
        start: { dateTime: `${date}T00:00:00.0000000`, timeZone: 'UTC' },
        end: { dateTime: `${tomorrow}T00:00:00.0000000`, timeZone: 'UTC' },
      }),
    );
    await msSignIn(h);
    const events = (await msToday(h)).events;
    const meeting = events.find((event) => event.title === 'sync')!;
    expect(meeting.link).toMatchObject({ service: 'teams', host: 'teams.microsoft.com' });
    expect(meeting).toMatchObject({ myStatus: 'tentative', othersInvited: true });
    expect(events.find((event) => event.title === 'Holiday')).toMatchObject({
      allDay: true,
      busy: false,
    });
    const detail = await h.client.send('post', '/api/calendar/event', {
      eventId: meeting.id,
      start: meeting.start,
      calendarKey: meeting.calendarKey,
    });
    expect(detail.status).toBe(200);
    expect(calendarEventDetailSchema.parse(detail.body)).toMatchObject({
      notes: 'Agenda',
      link: 'https://outlook.office365.com/owa/?itemid=AAMk&exvsurl=1',
      location: 'Room 1',
    });
  });

  it('names a recurring occurrence by its series, so a Mac copy of it shows once', async () => {
    h.microsoft.stop();
    h = microsoftHarness(t, { mac: true });
    h.fake.putMaster(OID, 'AAMkMaster', 'series-uid-1');
    const occurrence = graphMeeting('Weekly', 0, {
      type: 'occurrence',
      seriesMasterId: 'AAMkMaster',
      iCalUId: 'per-occurrence-uid',
    });
    h.fake.putEvent(OID, MS_CALENDAR, occurrence);
    await h.client.send('post', '/api/calendar/connect');
    h.host.calendars = [
      {
        id: 'ek-google',
        title: 'Work',
        sourceId: 'ek',
        sourceTitle: 'iCloud',
        sourceKind: 'caldav',
        color: '#ff0000',
        subscribed: false,
        writable: true,
        ownership: 'mine',
      },
    ];
    h.host.events = [macCopy('series-uid-1', noon(0), noon(30))];
    await msSignIn(h);
    const events = (await msToday(h)).events;
    const copies = events.filter((event) => event.title === 'Weekly' || event.title === 'Shared');
    expect(copies).toHaveLength(1);
    expect(h.fake.requests.some((request) => request.path.endsWith('/events/AAMkMaster'))).toBe(
      true,
    );
  });

  it('skips a calendar Graph won’t read by delta, and a series it won’t open', async () => {
    h.fake.addCalendar(OID, { id: 'AAMkShared', name: 'Team', canEdit: false });
    h.fake.failNext('/graph/v1.0/me/calendars/AAMkShared/calendarView/delta', {
      status: 400,
      code: 'ErrorInvalidRequest',
    });
    h.fake.failNext(`/graph/v1.0/me/calendars/${MS_CALENDAR}/events/AAMkHidden`, {
      status: 403,
      code: 'ErrorAccessDenied',
    });
    h.fake.putEvent(
      OID,
      MS_CALENDAR,
      graphMeeting('Shared series', 0, { type: 'occurrence', seriesMasterId: 'AAMkHidden' }),
    );
    await msSignIn(h);
    expect((await msStatus(h)).microsoft.accounts[0]?.state).toBe('ready');
    expect(await titles()).toEqual(['Shared series']);
  });

  it('refuses to send the token to a next link on another host', async () => {
    await msSignIn(h);
    const original = h.fake.fetch;
    let leaked = false;
    h.fake.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith('https://evil.example')) leaked = true;
      const response = await original(input, init);
      if (!url.endsWith('/me/calendars')) return response;
      return new Response(
        JSON.stringify({ value: [], '@odata.nextLink': 'https://evil.example/me/calendars' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    await h.microsoft.syncNow();
    expect(leaked).toBe(false);
  });
});

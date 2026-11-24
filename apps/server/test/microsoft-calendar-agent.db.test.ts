import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MICROSOFT_CALENDAR_SCOPES } from '@spark-outpost/contracts';
import { createMicrosoftAgentClient } from '../src/calendar/agent/microsoft-client.ts';
import { CALENDAR_CHANGED } from '../src/spark-mcp/actions/calendar-actions.ts';
import { cardResult } from './spark-mcp-support.ts';
import { FAKE_MICROSOFT_CLIENT_ID } from './fake-microsoft-graph.ts';
import {
  MS_CALENDAR,
  OID,
  microsoftHarness,
  msSignIn,
  msStatus,
  type MicrosoftHarness,
} from './microsoft-calendar-support.ts';
import { CalendarHarness, tomorrowAt } from './spark-calendar-support.ts';

let h: CalendarHarness;
let m: MicrosoftHarness;

beforeEach(async () => {
  h = await CalendarHarness.create();
  m = microsoftHarness(h.t);
});

afterEach(async () => {
  m.microsoft.stop();
  await h.close();
});

async function connectMicrosoft(mode = 'auto', allowEdit = true) {
  if (!allowEdit) m.fake.grantedScopes = [...MICROSOFT_CALENDAR_SCOPES];
  await msSignIn(m);
  const connected = await msStatus(m);
  const calendarKey = connected.accounts[0]!.calendars[0]!.key;
  if (allowEdit) await msSignIn(m, connected.microsoft.accounts[0]!.id, calendarKey);
  const [account] = (await msStatus(m)).microsoft.accounts;
  const calendarId = `microsoft:${account!.id}:${MS_CALENDAR}`;
  await h.start({
    mode,
    edit: ['work-1', calendarId],
    microsoft: createMicrosoftAgentClient({
      db: h.t.db,
      secrets: m.secrets,
      fetch: (input, init) => m.fake.fetch(input, init),
      client: {
        clientId: FAKE_MICROSOFT_CLIENT_ID,
        loginUrl: m.fake.loginUrl,
        graphUrl: m.fake.graphUrl,
      },
    }),
  });
  return { account: account!, calendarId, key: await h.key(calendarId) };
}

const graphTime = (iso: string) => ({ dateTime: iso.replace('Z', ''), timeZone: 'UTC' });

function putReview(extra: object = {}) {
  m.fake.putEvent(OID, MS_CALENDAR, {
    id: 'AAMkReview',
    iCalUId: 'review-uid',
    type: 'singleInstance',
    subject: 'Design review',
    start: graphTime(tomorrowAt(14)),
    end: graphTime(tomorrowAt(15)),
    isOrganizer: true,
    ...extra,
  });
}

describe('Microsoft calendars through the agent tools', () => {
  it('reads Microsoft events next to macOS ones', async () => {
    putReview();
    await connectMicrosoft();
    const read = await h.read();
    const titles = (read.facts.events as { title: string }[]).map((event) => event.title);
    expect(titles).toEqual(expect.arrayContaining(['Design review', 'Planning']));
    const calendars = (await h.call('spark_calendar', { action: 'calendars' })).facts.calendars as {
      source: string;
    }[];
    expect(calendars.map((calendar) => calendar.source)).toContain('microsoft');
  });

  it('creates and moves an event through Graph in UTC', async () => {
    const { key } = await connectMicrosoft();
    const created = await h.edit({
      action: 'create',
      calendar: key,
      title: 'Spark test',
      start: tomorrowAt(15),
      end: tomorrowAt(16),
      alarmMinutes: 10,
    });
    expect(created.facts.outcome).toBe('done');
    const ref = created.facts.ref as { eventId: string; occurrence: string };
    expect(m.fake.writes[0]).toMatchObject({
      method: 'POST',
      calendarId: MS_CALENDAR,
      body: {
        subject: 'Spark test',
        isAllDay: false,
        start: graphTime(tomorrowAt(15)),
        end: graphTime(tomorrowAt(16)),
        isReminderOn: true,
        reminderMinutesBeforeStart: 10,
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
    expect(m.fake.writes[1]).toMatchObject({
      method: 'PATCH',
      eventId: 'AAMkCreated1',
      body: { start: graphTime(tomorrowAt(17)), end: graphTime(tomorrowAt(18)) },
    });
  });

  it('deletes at once in Auto and says Outlook keeps it in Deleted Items', async () => {
    putReview();
    const { account, key } = await connectMicrosoft();
    const deleting = await h.edit({
      action: 'delete',
      calendar: key,
      eventId: `microsoft:${account.id}:AAMkReview`,
      occurrence: tomorrowAt(14),
    });
    expect(deleting.facts.outcome).toBe('done');
    expect(String(deleting.facts.message)).toContain('Outlook keeps it in Deleted Items.');
    expect(m.fake.eventOf(OID, MS_CALENDAR, 'AAMkReview')).toBeNull();
  });

  it('refuses to change a Microsoft event with other people, since Microsoft tells them', async () => {
    putReview({
      attendees: [{ type: 'required', emailAddress: { name: 'Ana', address: 'ana@contoso.com' } }],
    });
    const { account, key } = await connectMicrosoft();
    const refused = await h.edit({
      action: 'update',
      calendar: key,
      eventId: `microsoft:${account.id}:AAMkReview`,
      occurrence: tomorrowAt(14),
      title: 'Design review (moved)',
    });
    expect(refused.result.isError).toBe(true);
    expect(refused.text).toContain('tells attendees');
    expect(m.fake.writes).toEqual([]);
  });

  it('changes nothing when the event changed after the card was shown', async () => {
    putReview();
    const { account, key } = await connectMicrosoft('default');
    const moving = h.edit({
      action: 'update',
      calendar: key,
      eventId: `microsoft:${account.id}:AAMkReview`,
      occurrence: tomorrowAt(14),
      title: 'Design review (moved)',
    });
    const card = await h.pending();
    putReview({ subject: 'Renamed in Outlook' });
    await h.answer('confirm');
    await moving;
    const settled = await cardResult(h.t, card.id);
    expect(settled.payload.sparkResult).toMatchObject({
      state: 'failed',
      message: CALENDAR_CHANGED,
    });
    expect(m.fake.writes).toEqual([]);
  });

  it('refuses writes on an account that has not allowed editing', async () => {
    const { account, key } = await connectMicrosoft('auto', false);
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
    expect(m.fake.writes).toEqual([]);
  });
});

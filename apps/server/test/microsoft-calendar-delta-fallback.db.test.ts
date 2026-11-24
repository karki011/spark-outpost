import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cloudAccounts } from '../src/calendar/cloud/account-store.ts';
import { microsoftLiveAccount, pollMicrosoftAccount } from '../src/calendar/microsoft/accounts.ts';
import { FAKE_MICROSOFT_CLIENT_ID } from './fake-microsoft-graph.ts';
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

const DAY_MS = 24 * 60 * 60_000;
const TEAM = 'AAMkTeam';
const titles = async () => (await msToday(h)).events.map((event) => event.title);
const calls = (suffix: string) =>
  h.fake.requests.filter((request) => request.path.endsWith(suffix));
const teamDelta = () => calls(`/${TEAM}/calendarView/delta`);
const teamView = () => calls(`/${TEAM}/calendarView`);

function addTeam() {
  h.fake.addCalendar(OID, { id: TEAM, name: 'Team', canEdit: false });
}

function accountDeps(now: () => number) {
  return {
    db: t.db,
    workspaceId: t.workspaceId,
    secrets: h.secrets,
    fetch: h.fake.fetch,
    client: {
      clientId: FAKE_MICROSOFT_CLIENT_ID,
      loginUrl: h.fake.loginUrl,
      graphUrl: h.fake.graphUrl,
    },
    now,
  };
}

describe('Microsoft calendars without delta', () => {
  it('reads a calendar whose delta Graph refuses with a plain windowed calendarView', async () => {
    addTeam();
    h.fake.pageSize = 1;
    h.fake.refuseDelta.set(TEAM, { status: 400, code: 'ErrorInvalidRequest' });
    h.fake.putEvent(OID, TEAM, graphMeeting('standup', 0));
    h.fake.putEvent(OID, TEAM, graphMeeting('review', 60));
    await msSignIn(h);
    expect(await titles()).toEqual(['standup', 'review']);
    expect(teamDelta()).toHaveLength(1);
    const first = teamView()[0]!;
    expect(first.query.startDateTime).toBeDefined();
    expect(first.query.endDateTime).toBeDefined();
    expect(first.prefer).toContain('outlook.timezone="UTC"');
    expect(teamView().length).toBeGreaterThanOrEqual(2);

    h.fake.removeEvent(OID, TEAM, 'review');
    h.fake.putEvent(OID, TEAM, graphMeeting('standup', 30, { subject: 'moved' }));
    await h.microsoft.syncNow();
    expect(await titles()).toEqual(['moved']);
    expect(teamDelta()).toHaveLength(1);
    expect((await msStatus(h)).microsoft.accounts[0]?.state).toBe('ready');
  });

  it('falls back when a stored delta link is refused (501 or syncStateNotSupported)', async () => {
    addTeam();
    h.fake.putEvent(OID, TEAM, graphMeeting('first', 0));
    await msSignIn(h);
    expect(teamView()).toHaveLength(0);
    h.fake.refuseDelta.set(TEAM, { status: 501, code: 'NotImplemented' });
    h.fake.putEvent(OID, TEAM, graphMeeting('second', 60));
    await h.microsoft.syncNow();
    expect(await titles()).toEqual(['first', 'second']);
    expect(teamView()).toHaveLength(1);
    await h.microsoft.syncNow();
    expect(teamDelta()).toHaveLength(2);

    const other = 'AAMkOther';
    h.fake.addCalendar(OID, { id: other, name: 'Other', canEdit: false });
    h.fake.refuseDelta.set(other, { status: 409, code: 'syncStateNotSupported' });
    h.fake.putEvent(OID, other, graphMeeting('third', 90));
    await h.microsoft.syncNow();
    expect(await titles()).toEqual(['first', 'second', 'third']);
  });

  it('reports no change when a plain read finds the same events', async () => {
    addTeam();
    h.fake.refuseDelta.set(TEAM, { status: 400, code: 'ErrorInvalidRequest' });
    h.fake.putEvent(OID, TEAM, graphMeeting('same', 0));
    await msSignIn(h);
    const [row] = await cloudAccounts(t.db, 'microsoft', t.workspaceId);
    const account = microsoftLiveAccount(row!);
    const deps = accountDeps(Date.now);
    expect((await pollMicrosoftAccount(deps, account, () => 0.5)).changed).toBe(true);
    expect((await pollMicrosoftAccount(deps, account, () => 0.5)).changed).toBe(false);
    h.fake.putEvent(OID, TEAM, graphMeeting('same', 0, { subject: 'renamed' }));
    expect((await pollMicrosoftAccount(deps, account, () => 0.5)).changed).toBe(true);
  });

  it('backs off the account on 429 from the plain read, then tries delta again next window', async () => {
    addTeam();
    h.fake.refuseDelta.set(TEAM, { status: 400, code: 'ErrorInvalidRequest' });
    h.fake.putEvent(OID, TEAM, graphMeeting('kept', 0));
    await msSignIn(h);
    const [row] = await cloudAccounts(t.db, 'microsoft', t.workspaceId);
    const account = microsoftLiveAccount(row!);
    let now = Date.now();
    const deps = accountDeps(() => now);
    await pollMicrosoftAccount(deps, account, () => 0.5);
    expect(account.deltaRefused.has(TEAM)).toBe(true);
    const deltaBefore = teamDelta().length;

    h.fake.failNext(`/graph/v1.0/me/calendars/${TEAM}/calendarView`, {
      status: 429,
      code: 'TooManyRequests',
      retryAfter: 90,
    });
    const limited = await pollMicrosoftAccount(deps, account, () => 0.5);
    expect(limited.nextInMs).toBe(90_000);
    expect(account.state).toBe('error');
    expect(teamDelta()).toHaveLength(deltaBefore);

    await pollMicrosoftAccount(deps, account, () => 0.5);
    expect(account.state).toBe('ready');
    expect(teamDelta()).toHaveLength(deltaBefore);

    h.fake.refuseDelta.delete(TEAM);
    now += DAY_MS;
    await pollMicrosoftAccount(deps, account, () => 0.5);
    expect(teamDelta()).toHaveLength(deltaBefore + 1);
    expect(account.deltaRefused.has(TEAM)).toBe(false);
  });

  it('keeps reading the main calendar by delta while another falls back', async () => {
    addTeam();
    h.fake.refuseDelta.set(TEAM, { status: 400, code: 'ErrorInvalidRequest' });
    h.fake.putEvent(OID, MS_CALENDAR, graphMeeting('main', 0));
    await msSignIn(h);
    await h.microsoft.syncNow();
    expect(calls(`/${encodeURIComponent(MS_CALENDAR)}/calendarView`)).toHaveLength(0);
    expect(
      calls(`/${encodeURIComponent(MS_CALENDAR)}/calendarView/delta`).at(-1)?.query.$deltatoken,
    ).toBeDefined();
  });
});

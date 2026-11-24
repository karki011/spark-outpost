import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MICROSOFT_CALENDAR_SCOPES,
  MICROSOFT_EDIT_DECLINED,
  MICROSOFT_EDIT_NEEDS_GRANT,
  MICROSOFT_EDIT_SCOPE,
} from '@spark-outpost/contracts';
import { MICROSOFT_SIGN_IN_AGAIN } from '../src/calendar/microsoft/accounts.ts';
import { MICROSOFT_DISCONNECTED } from '../src/calendar/microsoft/routes.ts';
import {
  MICROSOFT_SCOPES_MISSING,
  MICROSOFT_SIGN_IN_DENIED,
  MICROSOFT_SIGN_IN_WRONG_STATE,
} from '../src/calendar/microsoft/sign-in.ts';
import { microsoftCalendarSecret } from '../src/setup/secrets.ts';
import {
  MS_EMAIL,
  OID,
  graphMeeting,
  microsoftHarness,
  msSignIn,
  msStatus,
  msToday,
  startMsSignIn,
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

describe('Microsoft sign-in', () => {
  it('asks the common tenant for read scopes only, with PKCE, state and a loopback redirect', async () => {
    const flow = await startMsSignIn(h);
    const url = new URL(flow.authorizeUrl!);
    expect(url.pathname).toBe('/login/common/oauth2/v2.0/authorize');
    expect(url.searchParams.get('scope')).toBe(MICROSOFT_CALENDAR_SCOPES.join(' '));
    expect(url.searchParams.get('scope')).not.toContain(MICROSOFT_EDIT_SCOPE);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toMatch(/^[\w-]{40,}$/);
    expect(url.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('connects an account keyed by its object id, keeping the refresh token only in the keychain', async () => {
    h.fake.putEvent(OID, 'AAMkAGI2TGuLAAA=', graphMeeting('standup', 0));
    expect((await msSignIn(h)).status).toBe('connected');
    const after = await msStatus(h);
    expect(after.microsoft).toMatchObject({
      available: true,
      accounts: [{ email: MS_EMAIL, state: 'ready', canEdit: false }],
    });
    expect(after.accounts).toEqual([
      expect.objectContaining({
        id: `microsoft:${after.microsoft.accounts[0]!.id}`,
        kind: 'microsoft',
        calendars: [expect.objectContaining({ include: true, nudges: true, writable: true })],
      }),
    ]);
    expect(await h.secrets.get(microsoftCalendarSecret(OID))).toMatch(/^M\.R3_fake/);
    const { rows } = await t.db.query('SELECT * FROM calendar_microsoft_accounts');
    expect(rows).toEqual([expect.objectContaining({ subject: OID, email: MS_EMAIL })]);
    expect(JSON.stringify(rows)).not.toContain('M.R3_fake');
    expect((await msToday(h)).events.map((event) => event.title)).toEqual(['standup']);
  });

  it('asks Microsoft who signed in when the id token carries no email', async () => {
    h.fake.idTokenEmail = false;
    expect((await msSignIn(h)).status).toBe('connected');
    expect((await msStatus(h)).microsoft.accounts[0]?.email).toBe(MS_EMAIL);
    expect(h.fake.requests.some((request) => request.path === '/graph/v1.0/me')).toBe(true);
  });

  it('answers a cancelled sign-in, a wrong state and missing scopes without connecting', async () => {
    h.fake.deny = 'access_denied';
    expect((await msSignIn(h)).message).toBe(MICROSOFT_SIGN_IN_DENIED);
    h.fake.deny = null;

    const flow = await startMsSignIn(h);
    const forged = new URL(h.fake.authorize(flow.authorizeUrl!));
    forged.searchParams.set('state', 'forged');
    await fetch(forged);
    await h.microsoft.signInSettled();
    expect(h.microsoft.signInFlow().message).toBe(MICROSOFT_SIGN_IN_WRONG_STATE);

    h.fake.grantedScopes = ['openid', 'email', 'offline_access'];
    expect((await msSignIn(h)).message).toBe(MICROSOFT_SCOPES_MISSING);
    expect((await msStatus(h)).microsoft.accounts).toEqual([]);
    expect(await h.secrets.get(microsoftCalendarSecret(OID))).toBeNull();
  });

  it('saves the refresh token Microsoft rotates, and asks to sign in again on invalid_grant', async () => {
    await msSignIn(h);
    const first = await h.secrets.get(microsoftCalendarSecret(OID));
    h.fake.failNext('/graph/v1.0/me/calendars', {
      status: 401,
      code: 'InvalidAuthenticationToken',
    });
    await h.microsoft.syncNow();
    expect(h.fake.refreshTokenRotations()).toBe(1);
    const rotated = await h.secrets.get(microsoftCalendarSecret(OID));
    expect(rotated).not.toBe(first);
    expect((await msStatus(h)).microsoft.accounts[0]?.state).toBe('ready');

    h.fake.expireRefreshTokens();
    h.fake.failNext('/graph/v1.0/me/calendars', {
      status: 401,
      code: 'InvalidAuthenticationToken',
    });
    await h.microsoft.syncNow();
    const account = (await msStatus(h)).microsoft.accounts[0]!;
    expect(account).toMatchObject({ state: 'sign_in_again', message: MICROSOFT_SIGN_IN_AGAIN });
    expect((await msToday(h)).events).toEqual([]);

    h.fake.grantedScopes = [...MICROSOFT_CALENDAR_SCOPES];
    expect((await msSignIn(h, account.id)).status).toBe('connected');
    expect((await msStatus(h)).microsoft.accounts[0]?.state).toBe('ready');
  });

  it('refuses another account when signing in again to one', async () => {
    await msSignIn(h);
    const accountId = (await msStatus(h)).microsoft.accounts[0]!.id;
    h.fake.addUser('11111111-2222-3333-4444-555555555555', 'other@contoso.com');
    h.fake.signInAs = '11111111-2222-3333-4444-555555555555';
    expect((await msSignIn(h, accountId)).message).toBe(
      `That was a different Microsoft account. Sign in as ${MS_EMAIL}.`,
    );
    expect((await msStatus(h)).microsoft.accounts).toHaveLength(1);
  });

  it('disconnects: deletes the token and the account, and says where to remove the app', async () => {
    await msSignIn(h);
    const accountId = (await msStatus(h)).microsoft.accounts[0]!.id;
    const response = await h.client.send('delete', `/api/calendar/microsoft/accounts/${accountId}`);
    expect(response.status).toBe(200);
    expect(response.body.message).toBe(MICROSOFT_DISCONNECTED);
    expect(response.body.status.microsoft.accounts).toEqual([]);
    expect(await h.secrets.get(microsoftCalendarSecret(OID))).toBeNull();
    const { rows } = await t.db.query('SELECT * FROM calendar_calendars');
    expect(rows).toEqual([]);
    const again = await h.client.send('delete', `/api/calendar/microsoft/accounts/${accountId}`);
    expect(again.status).toBe(400);
  });
});

describe('Agents can edit on a Microsoft calendar', () => {
  async function calendarKey() {
    const status = await msStatus(h);
    return {
      accountId: status.microsoft.accounts[0]!.id,
      key: status.accounts[0]!.calendars[0]!.key,
    };
  }

  it('needs the grant before the switch turns on', async () => {
    h.fake.grantedScopes = [...MICROSOFT_CALENDAR_SCOPES];
    await msSignIn(h);
    const { key } = await calendarKey();
    const response = await h.client.send('patch', `/api/calendar/calendars/${key}`, {
      agentsEdit: true,
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe(MICROSOFT_EDIT_NEEDS_GRANT);
  });

  it('asks for Calendars.ReadWrite incrementally and turns the switch on when granted', async () => {
    h.fake.grantedScopes = [...MICROSOFT_CALENDAR_SCOPES, MICROSOFT_EDIT_SCOPE];
    await msSignIn(h);
    const { accountId, key } = await calendarKey();
    const flow = await startMsSignIn(h, accountId, key);
    const url = new URL(flow.authorizeUrl!);
    expect(url.searchParams.get('scope')!.split(' ')).toContain(MICROSOFT_EDIT_SCOPE);
    expect(url.searchParams.get('login_hint')).toBe(MS_EMAIL);
    await fetch(h.fake.authorize(flow.authorizeUrl!));
    await h.microsoft.signInSettled();
    expect(h.microsoft.signInFlow().status).toBe('connected');
    const after = await msStatus(h);
    expect(after.microsoft.accounts[0]?.canEdit).toBe(true);
    expect(after.accounts[0]?.calendars[0]?.agentsEdit).toBe(true);
  });

  it('leaves the switch off with a note when the user declines', async () => {
    h.fake.grantedScopes = [...MICROSOFT_CALENDAR_SCOPES];
    await msSignIn(h);
    const { accountId, key } = await calendarKey();
    for (const declined of ['access_denied', 'consent_required']) {
      h.fake.deny = declined;
      expect((await msSignIn(h, accountId, key)).message).toBe(MICROSOFT_EDIT_DECLINED);
    }
    h.fake.deny = null;
    expect((await msSignIn(h, accountId, key)).message).toBe(MICROSOFT_EDIT_DECLINED);
    const after = await msStatus(h);
    expect(after.microsoft.accounts[0]?.canEdit).toBe(false);
    expect(after.accounts[0]?.calendars[0]?.agentsEdit).toBe(false);
    expect(after.microsoft.accounts[0]?.state).toBe('ready');
  });
});

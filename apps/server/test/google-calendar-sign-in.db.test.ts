import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GOOGLE_CALENDAR_SCOPES, GOOGLE_EVENTS_EDIT_SCOPE } from '@spark-outpost/contracts';
import { googleCalendarSecret } from '../src/setup/secrets.ts';
import {
  GOOGLE_SCOPES_MISSING,
  GOOGLE_SIGN_IN_DENIED,
  GOOGLE_SIGN_IN_WRONG_STATE,
} from '../src/calendar/google/sign-in.ts';
import { SIGN_IN_AGAIN } from '../src/calendar/google/accounts.ts';
import { GOOGLE_NOT_REVOKED } from '../src/calendar/google/routes.ts';
import {
  EMAIL,
  SUBJECT,
  googleHarness,
  at,
  macCopy,
  meeting,
  signIn,
  soon,
  startSignIn,
  status,
  today,
  upcoming,
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

describe('Google sign-in', () => {
  it('asks for the calendar scopes with events editing, with PKCE, state and a loopback redirect', async () => {
    const flow = await startSignIn(h);
    expect(flow.status).toBe('waiting');
    const url = new URL(flow.authorizeUrl!);
    expect(url.searchParams.get('scope')).toBe(GOOGLE_CALENDAR_SCOPES.join(' '));
    expect(url.searchParams.get('scope')).toContain(GOOGLE_EVENTS_EDIT_SCOPE);
    expect(url.searchParams.get('scope')).not.toMatch(/auth\/calendar( |$)/);
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toMatch(/^[\w-]{40,}$/);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('connects an account, keeps the refresh token only in the keychain and shows its events', async () => {
    h.fake.putEvent(SUBJECT, EMAIL, meeting('standup', 0));
    expect((await signIn(h)).status).toBe('connected');
    const after = await status(h);
    expect(after.google).toMatchObject({
      available: true,
      testing: true,
      accounts: [{ email: EMAIL, state: 'ready', message: null }],
    });
    expect(after.accounts).toEqual([
      expect.objectContaining({
        title: EMAIL,
        kind: 'google',
        calendars: [expect.objectContaining({ include: true, nudges: true })],
      }),
    ]);
    expect(await h.secrets.get(googleCalendarSecret(SUBJECT))).toMatch(/^1\/\/fake-refresh/);
    const { rows } = await t.db.query('SELECT * FROM calendar_google_accounts');
    expect(JSON.stringify(rows)).not.toContain('fake-refresh');
    expect((await today(h)).events.map((event) => event.title)).toEqual(['standup']);
  });

  it('keeps one token per account: signing in again replaces it without revoking the grant', async () => {
    await signIn(h);
    const first = await h.secrets.get(googleCalendarSecret(SUBJECT));
    await signIn(h);
    const second = await h.secrets.get(googleCalendarSecret(SUBJECT));
    expect(second).not.toBe(first);
    expect(h.fake.revoked.size).toBe(0);
    h.fake.failNext('/calendar/v3/users/me/calendarList', { status: 401 });
    await h.google.syncNow();
    expect((await status(h)).google.accounts).toEqual([
      expect.objectContaining({ state: 'ready' }),
    ]);
  });

  it('connects several accounts', async () => {
    h.fake.addUser('2', 'second@example.com');
    h.fake.addCalendar('2', { id: 'second@example.com', accessRole: 'owner', primary: true });
    await signIn(h);
    h.fake.signInAs = '2';
    await signIn(h);
    const titles = (await status(h)).accounts.map((account) => account.title);
    expect(titles).toEqual([EMAIL, 'second@example.com']);
  });

  it('answers a cancelled sign-in, a wrong state and missing scopes without connecting', async () => {
    h.fake.deny = 'access_denied';
    expect((await signIn(h)).message).toBe(GOOGLE_SIGN_IN_DENIED);
    h.fake.deny = null;

    const flow = await startSignIn(h);
    const forged = new URL(h.fake.authorize(flow.authorizeUrl!));
    forged.searchParams.set('state', 'forged');
    await fetch(forged);
    await h.google.signInSettled();
    expect(h.google.signInFlow().message).toBe(GOOGLE_SIGN_IN_WRONG_STATE);

    h.fake.grantedScopes = ['openid', 'email'];
    expect((await signIn(h)).message).toBe(GOOGLE_SCOPES_MISSING);
    expect((await status(h)).google.accounts).toEqual([]);
    const [partial] = h.fake.refreshTokensOf(SUBJECT);
    expect(h.fake.revoked.has(partial!)).toBe(true);
  });

  it('keeps a connected account working when it signs in again with a partial grant', async () => {
    await signIn(h);
    h.fake.grantedScopes = ['openid', 'email'];
    expect((await signIn(h)).message).toBe(GOOGLE_SCOPES_MISSING);
    expect(h.fake.revoked.size).toBe(0);
    expect((await status(h)).google.accounts[0]?.state).toBe('ready');
  });

  it('serves the loopback answer once and nothing else', async () => {
    const flow = await startSignIn(h);
    const redirect = new URL(flow.authorizeUrl!).searchParams.get('redirect_uri')!;
    expect((await fetch(`${redirect}/other?code=x&state=y`)).status).toBe(404);
    const back = h.fake.authorize(flow.authorizeUrl!);
    const page = await fetch(back);
    expect(await page.text()).not.toContain('code-');
    await h.google.signInSettled();
    await expect(fetch(back)).rejects.toThrow();
  });
});

describe('Google tokens and disconnect', () => {
  it('asks to sign in again when Google refuses the refresh token, keeping the choices', async () => {
    await signIn(h);
    const [account] = (await status(h)).google.accounts;
    h.fake.expireRefreshTokens();
    h.fake.failNext('/calendar/v3/users/me/calendarList', { status: 401 });
    await h.google.syncNow();
    const after = await status(h);
    expect(after.google.accounts).toEqual([
      expect.objectContaining({ state: 'sign_in_again', message: SIGN_IN_AGAIN }),
    ]);
    expect(after.accounts[0]?.calendars).toHaveLength(1);
    expect((await today(h)).events).toEqual([]);

    expect((await signIn(h, account!.id)).status).toBe('connected');
    expect((await status(h)).google.accounts[0]?.state).toBe('ready');
  });

  it('does not revoke a mismatched sign-in whose account Spark already has', async () => {
    h.fake.addUser('2', 'second@example.com');
    h.fake.addCalendar('2', { id: 'second@example.com', accessRole: 'owner', primary: true });
    await signIn(h);
    h.fake.signInAs = '2';
    await signIn(h);
    const first = (await status(h)).google.accounts.find((item) => item.email === EMAIL)!;
    expect((await signIn(h, first.id)).message).toBe(
      `That was a different Google account. Sign in as ${EMAIL}.`,
    );
    expect(h.fake.revoked.size).toBe(0);
    h.fake.failNext('/calendar/v3/users/me/calendarList', { status: 401 });
    h.fake.failNext('/calendar/v3/users/me/calendarList', { status: 401 });
    await h.google.syncNow();
    expect((await status(h)).google.accounts.map((item) => item.state)).toEqual(['ready', 'ready']);
  });

  it('refuses a different account when signing in again', async () => {
    await signIn(h);
    const [account] = (await status(h)).google.accounts;
    h.fake.addUser('other', 'other@example.com');
    h.fake.signInAs = 'other';
    expect((await signIn(h, account!.id)).message).toBe(
      `That was a different Google account. Sign in as ${EMAIL}.`,
    );
    expect((await status(h)).google.accounts.map((item) => item.email)).toEqual([EMAIL]);
    expect(h.fake.refreshTokensOf('other').every((token) => h.fake.revoked.has(token))).toBe(true);
  });

  it('renews an expired access token with the refresh token', async () => {
    await signIn(h);
    h.fake.failNext('/calendar/v3/users/me/calendarList', { status: 401 });
    await h.google.syncNow();
    expect((await status(h)).google.accounts[0]?.state).toBe('ready');
    expect(h.fake.requests.filter((request) => request.path === '/token')).toHaveLength(2);
  });

  it('revokes the token, deletes it from the keychain and forgets the account', async () => {
    await signIn(h);
    const token = await h.secrets.get(googleCalendarSecret(SUBJECT));
    const [account] = (await status(h)).google.accounts;
    const response = await h.client.send('delete', `/api/calendar/google/accounts/${account!.id}`);
    expect(response.status).toBe(200);
    expect(response.body.message).toBeNull();
    expect(h.fake.revoked.has(token!)).toBe(true);
    expect(await h.secrets.get(googleCalendarSecret(SUBJECT))).toBeNull();
    const after = await status(h);
    expect(after.google.accounts).toEqual([]);
    expect(after.accounts).toEqual([]);
    const { rows } = await t.db.query('SELECT 1 FROM calendar_calendars');
    expect(rows).toEqual([]);
  });

  it('forgets an account whose row a Reset removed', async () => {
    await signIn(h);
    await t.db.query('DELETE FROM calendar_google_accounts');
    const after = await status(h);
    expect(after.google.accounts).toEqual([]);
    expect(after.accounts).toEqual([]);
  });

  it('keeps a mark on an event macOS Calendar still shows when Google is disconnected', async () => {
    h = googleHarness(t, { mac: true });
    h.host.calendars = [
      {
        id: 'ek-google',
        title: EMAIL,
        sourceId: 'ek-src',
        sourceTitle: 'Google',
        sourceKind: 'caldav',
        color: '#336699',
        subscribed: false,
        writable: true,
        ownership: 'mine',
      },
    ];
    const [start, end, later, last] = [at(60), at(90), at(120), at(150)];
    h.host.events = [macCopy('shared@google.com', start, end)];
    await h.client.send('post', '/api/calendar/connect');
    h.fake.putEvent(SUBJECT, EMAIL, soon('shared', start, end));
    h.fake.putEvent(SUBJECT, EMAIL, soon('google-only', later, last));
    await signIn(h);
    for (const event of await upcoming(h)) {
      await h.client.send('put', '/api/calendar/marks', {
        eventKey: event.key,
        end: event.end,
        kind: 'remind_5',
        on: true,
      });
    }
    const [account] = (await status(h)).google.accounts;
    const removed = await h.client.send('delete', `/api/calendar/google/accounts/${account!.id}`);
    expect(removed.body).toMatchObject({ message: null });
    const { rows } = await t.db.query<{ uid: string }>('SELECT uid FROM calendar_marks');
    expect(rows.map((row) => row.uid)).toEqual(['shared@google.com']);
    expect((await upcoming(h)).find((event) => event.title === 'Shared')?.remind).toBe(true);
  });

  it('purges the Spark marks on its events when an account is disconnected', async () => {
    h.fake.putEvent(SUBJECT, EMAIL, meeting('marked', 0));
    await signIn(h);
    const [event] = (await today(h)).events;
    const marked = await h.client.send('put', '/api/calendar/marks', {
      eventKey: event!.key,
      end: event!.end,
      kind: 'remind_5',
      on: true,
    });
    expect(marked.status).toBe(200);
    await t.db.query(
      `INSERT INTO calendar_marks (workspace_id, uid, occurrence_start, kind, ends_at)
       VALUES ($1, 'mac-only', now(), 'hold', now() + interval '1 hour')`,
      [t.workspaceId],
    );
    const [account] = (await status(h)).google.accounts;
    await h.client.send('delete', `/api/calendar/google/accounts/${account!.id}`);
    const { rows } = await t.db.query<{ uid: string }>('SELECT uid FROM calendar_marks');
    expect(rows.map((row) => row.uid)).toEqual(['mac-only']);
  });

  it('still deletes the token when Google cannot confirm the revoke', async () => {
    await signIn(h);
    const [account] = (await status(h)).google.accounts;
    h.fake.failNext('/revoke', { status: 503 });
    const response = await h.client.send('delete', `/api/calendar/google/accounts/${account!.id}`);
    expect(response.body.message).toBe(GOOGLE_NOT_REVOKED);
    expect(await h.secrets.get(googleCalendarSecret(SUBJECT))).toBeNull();
  });
});

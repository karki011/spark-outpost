import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZOOM_SIGN_IN_AGAIN, googleSignInFlowSchema } from '@spark-outpost/contracts';
import { memorySecretStore, zoomSecret, type SecretStore } from '../src/setup/secrets.ts';
import { ZOOM_NOT_REVOKED } from '../src/zoom/routes.ts';
import {
  ZOOM_SIGN_IN_WRONG_STATE,
  ZoomSignInNeeded,
  createZoomService,
  type ZoomService,
} from '../src/zoom/service.ts';
import { FAKE_ZOOM_CLIENT_ID, fakeZoom, type FakeZoom } from './fake-zoom.ts';
import { googleHarness, noon, signIn, status, type Harness } from './google-calendar-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let fake: FakeZoom;
let secrets: SecretStore;
let zoom: ZoomService;
let h: Harness;
let clock = Date.parse('2026-12-01T10:00:00Z');

function service(): ZoomService {
  return createZoomService({
    db: t.db,
    workspaceId: t.workspaceId,
    secrets,
    fetch: fake.fetch,
    now: () => clock,
    client: {
      clientId: FAKE_ZOOM_CLIENT_ID,
      oauthUrl: fake.baseUrl,
      apiUrl: `${fake.baseUrl}/v2`,
    },
  });
}

beforeEach(async () => {
  t = await createTestDb();
  fake = fakeZoom();
  secrets = memorySecretStore();
  zoom = service();
  h = googleHarness(t, { zoom });
});

afterEach(async () => {
  zoom.cancelSignIn();
  h.google.stop();
  await t.cleanup();
});

async function answer(flowUrl: string, overrides: Record<string, string> = {}) {
  const asked = new URL(flowUrl);
  const back = new URL(asked.searchParams.get('redirect_uri')!);
  back.searchParams.set('code', fake.code());
  back.searchParams.set('state', asked.searchParams.get('state')!);
  for (const [name, value] of Object.entries(overrides)) back.searchParams.set(name, value);
  await fetch(back);
  await zoom.signInSettled();
}

async function connect() {
  const started = await h.client.send('post', '/api/zoom/sign-in', {});
  const flow = googleSignInFlowSchema.parse(started.body);
  await answer(flow.authorizeUrl!);
}

const MEETING = { topic: 'Launch review', start: '2026-12-02T15:00:00Z', minutes: 30 };

describe('Zoom sign-in', () => {
  it('asks Zoom with PKCE and a loopback address, and no secret', async () => {
    const flow = await zoom.signIn();
    const asked = new URL(flow.authorizeUrl!);
    expect(asked.origin + asked.pathname).toBe(`${fake.baseUrl}/oauth/authorize`);
    expect(asked.searchParams.get('client_id')).toBe(FAKE_ZOOM_CLIENT_ID);
    expect(asked.searchParams.get('code_challenge_method')).toBe('S256');
    expect(asked.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(asked.searchParams.has('client_secret')).toBe(false);
  });

  it('keeps the refresh token in the keychain and shows the account', async () => {
    await connect();
    const shown = await h.client.get('/api/zoom/status');
    expect(shown.body).toMatchObject({
      available: true,
      account: { email: 'me@example.com', needsSignIn: false },
      signIn: { status: 'connected' },
    });
    expect(await secrets.get(zoomSecret('zoom-user-1'))).toBe('zoom-refresh-1');
    expect(JSON.stringify(shown.body)).not.toContain('zoom-refresh');
  });

  it('refuses an answer with the wrong state and connects nothing', async () => {
    const flow = await zoom.signIn();
    await answer(flow.authorizeUrl!, { state: 'someone-else' });
    expect(zoom.signInFlow()).toMatchObject({
      status: 'failed',
      message: ZOOM_SIGN_IN_WRONG_STATE,
    });
    expect((await zoom.status()).account).toBeNull();
  });
});

describe('Cancelling a Zoom sign-in', () => {
  it('connects nothing when Cancel arrives while the code is being exchanged', async () => {
    let release = () => {};
    fake.holdTokens = new Promise<void>((resolve) => {
      release = resolve;
    });
    const flow = await zoom.signIn();
    const asked = new URL(flow.authorizeUrl!);
    const back = new URL(asked.searchParams.get('redirect_uri')!);
    back.searchParams.set('code', fake.code());
    back.searchParams.set('state', asked.searchParams.get('state')!);
    await fetch(back);
    zoom.cancelSignIn();
    release();
    await zoom.signInSettled();
    expect(zoom.signInFlow().status).toBe('idle');
    expect((await zoom.status()).account).toBeNull();
  });
});

describe('Staying signed in to Zoom', () => {
  it('reuses the access token, then renews it and saves the new refresh token', async () => {
    await connect();
    await zoom.createMeeting(MEETING);
    await zoom.createMeeting(MEETING);
    expect(fake.refreshTokens).toEqual(['zoom-refresh-1']);
    clock += 61 * 60_000;
    await zoom.createMeeting(MEETING);
    expect(fake.refreshTokens).toEqual(['zoom-refresh-1', 'zoom-refresh-2']);
    expect(await secrets.get(zoomSecret('zoom-user-1'))).toBe('zoom-refresh-2');
  });

  it('stays signed in after a restart, from the keychain alone', async () => {
    await connect();
    const restarted = service();
    const meeting = await restarted.createMeeting(MEETING);
    expect(meeting.joinUrl).toMatch(/^https:\/\/acme\.zoom\.us\/j\/\d+$/);
    expect(await secrets.get(zoomSecret('zoom-user-1'))).toBe('zoom-refresh-2');
    expect((await restarted.status()).account).toMatchObject({ needsSignIn: false });
  });

  it('renews once when two calls arrive with an expired token', async () => {
    await connect();
    clock += 61 * 60_000;
    await Promise.all([zoom.createMeeting(MEETING), zoom.createMeeting(MEETING)]);
    expect(fake.refreshTokens).toHaveLength(2);
  });

  it('renews and retries when Zoom says the access token is no longer good', async () => {
    await connect();
    fake.expireAccess();
    await expect(zoom.createMeeting(MEETING)).resolves.toMatchObject({ id: expect.any(String) });
    expect(fake.refreshTokens).toHaveLength(2);
  });

  it('renews by itself once a week, so the sign-in never reaches Zoom’s 90 days', async () => {
    await connect();
    clock += 6 * 24 * 60 * 60_000;
    await zoom.keepAlive();
    expect(fake.refreshTokens).toHaveLength(1);
    clock += 2 * 24 * 60 * 60_000;
    await service().keepAlive();
    expect(fake.refreshTokens).toHaveLength(2);
    expect(await secrets.get(zoomSecret('zoom-user-1'))).toBe('zoom-refresh-2');
    await service().keepAlive();
    expect(fake.refreshTokens).toHaveLength(2);
  });

  it('keeps the sign-in when a background renewal cannot reach Zoom', async () => {
    await connect();
    clock += 8 * 24 * 60 * 60_000;
    const offline = createZoomService({
      db: t.db,
      workspaceId: t.workspaceId,
      secrets,
      now: () => clock,
      fetch: () => Promise.reject(new Error('offline')),
      client: { clientId: FAKE_ZOOM_CLIENT_ID, oauthUrl: fake.baseUrl, apiUrl: fake.baseUrl },
    });
    await offline.keepAlive();
    expect((await zoom.status()).account).toMatchObject({ needsSignIn: false });
    expect(await secrets.get(zoomSecret('zoom-user-1'))).toBe('zoom-refresh-1');
  });

  it('asks to sign in again only when Zoom refuses the refresh token', async () => {
    await connect();
    fake.rejectRefresh();
    clock += 61 * 60_000;
    await expect(zoom.createMeeting(MEETING)).rejects.toThrow(ZoomSignInNeeded);
    expect((await zoom.status()).account).toMatchObject({ needsSignIn: true });
    await expect(zoom.createMeeting(MEETING)).rejects.toThrow(ZOOM_SIGN_IN_AGAIN);
  });

  it('keeps the sign-in when Zoom answers a renewal with something other than a refusal', async () => {
    await connect();
    fake.refreshStatus = 403;
    clock += 61 * 60_000;
    await expect(zoom.createMeeting(MEETING)).rejects.toThrow(/403/);
    expect((await zoom.status()).account).toMatchObject({ needsSignIn: false });
    fake.refreshStatus = null;
    await expect(zoom.createMeeting(MEETING)).resolves.toMatchObject({ id: expect.any(String) });
  });

  it('disconnects: revokes, forgets the token and the account', async () => {
    await connect();
    const gone = await h.client.send('delete', '/api/zoom/account', {});
    expect(gone.body).toMatchObject({ status: { account: null }, message: null });
    expect(fake.revoked).toEqual(['zoom-access-1']);
    expect(await secrets.get(zoomSecret('zoom-user-1'))).toBeNull();
    expect(ZOOM_NOT_REVOKED).toContain('marketplace.zoom.us');
  });
});

describe('A Google event with a Zoom link', () => {
  async function request(overrides: object = {}) {
    const calendarKey = (await status(h)).accounts[0]!.calendars[0]!.key!;
    return {
      calendarKey,
      title: 'Launch review',
      start: noon(60),
      end: noon(90),
      guests: [],
      video: 'zoom',
      location: '',
      notes: 'Agenda to follow.',
      ...overrides,
    };
  }

  async function allowEdits() {
    await signIn(h);
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

  it('creates the Zoom meeting and puts its link on the event', async () => {
    await allowEdits();
    await connect();
    const created = await h.client.send('post', '/api/calendar/events', await request());
    expect(created.status).toBe(200);
    const [id, meeting] = [...fake.meetings][0]!;
    expect(meeting).toMatchObject({ topic: 'Launch review', type: 2, duration: 30 });
    const link = `https://acme.zoom.us/j/${id}`;
    expect(h.fake.writes[0]!.body).toMatchObject({
      location: link,
      description: `Agenda to follow.\n\nJoin Zoom meeting: ${link}`,
    });
    expect(h.fake.writes[0]!.body).not.toHaveProperty('conferenceData');
  });

  it('keeps a typed location and still adds the link to the description', async () => {
    await allowEdits();
    await connect();
    await h.client.send('post', '/api/calendar/events', await request({ location: 'Room 4' }));
    expect(h.fake.writes[0]!.body).toMatchObject({ location: 'Room 4' });
    expect(String(h.fake.writes[0]!.body!.description)).toContain('https://acme.zoom.us/j/');
  });

  it('deletes the Zoom meeting when Google does not take the event', async () => {
    await signIn(h);
    await connect();
    const refused = await h.client.send('post', '/api/calendar/events', await request());
    expect(refused.status).toBe(403);
    expect(fake.meetings.size).toBe(0);
    expect(fake.requests.map((item) => item.method)).toEqual(['GET', 'POST', 'DELETE']);
  });

  it('writes nothing to Google while Zoom is not connected', async () => {
    await allowEdits();
    const refused = await h.client.send('post', '/api/calendar/events', await request());
    expect(refused.status).toBe(403);
    expect(h.fake.writes).toEqual([]);
  });
});

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SLACK_DM_SCOPES, isSlackAuthorizeUrl } from '@spark-outpost/contracts';
import { SLACK_SIGN_IN_SECRET, memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { allowSlackChannels } from '../src/slack/channels.ts';
import { removeSlack, saveSlack, slackStatus } from '../src/slack/connection.ts';
import {
  SIGN_IN_DENIED,
  SIGN_IN_TIMED_OUT,
  SIGN_IN_TTL_MS,
  SIGN_IN_WRONG_STATE,
  createSlackSignIn,
} from '../src/slack/sign-in.ts';
import { LOCAL_HEADERS, createTestApp } from './app-support.ts';
import { SLACK_CLIENT_ID } from './fake-slack-oauth.ts';
import { SLACK_BOT_TOKEN, SLACK_ME } from './fake-slack.ts';
import {
  ALL_SLACK_TOKENS,
  SLACK_SIGN_IN,
  databaseText,
  signInToSlack,
  slackDeps,
  startSlackStub,
  type SlackStub,
} from './slack-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let stub: SlackStub;
let secrets: SecretStore;
let clock = Date.parse('2026-10-05T10:00:00Z');
const deps = () => ({ ...slackDeps(t, stub, secrets), now: () => clock });
const flowOf = () => createSlackSignIn({ ...deps(), signIn: SLACK_SIGN_IN });
const oauth = () => stub.slack.oauth;

beforeEach(async () => {
  t = await createTestDb();
  stub = await startSlackStub();
  secrets = memorySecretStore();
  clock = Date.parse('2026-10-05T10:00:00Z');
});

afterEach(async () => {
  await stub.close();
  await t.cleanup();
});

describe('signing in with Slack', () => {
  it('asks Slack for user scopes only, with a PKCE challenge and a state, on slack.com', async () => {
    const flow = await flowOf().start({ directMessages: false, replace: false });
    const url = new URL(flow.authorizeUrl!);

    expect(isSlackAuthorizeUrl(flow.authorizeUrl!)).toBe(true);
    expect(flow.status).toBe('waiting');
    expect(url.searchParams.get('client_id')).toBe(SLACK_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe('spark-outpost-dev://slack/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.has('scope')).toBe(false);
    expect(url.searchParams.has('client_secret')).toBe(false);
    const scopes = url.searchParams.get('user_scope')!.split(',');
    expect(scopes).toEqual(expect.arrayContaining(['channels:history', 'chat:write']));
    for (const scope of SLACK_DM_SCOPES) expect(scopes).not.toContain(scope);
  });

  it('connects as the user: tokens in the keychain only, team, member, scopes and expiry in the row', async () => {
    const logs = vi.spyOn(console, 'error');
    const signIn = await signInToSlack(deps(), stub);
    const status = await slackStatus(deps());

    expect(signIn.state()).toMatchObject({ status: 'connected', authorizeUrl: null });
    expect(status).toMatchObject({
      signInAvailable: true,
      connection: {
        method: 'sign_in',
        state: 'connected',
        team: 'Acme',
        member: { id: SLACK_ME, name: 'Alex Example' },
        tokens: { bot: false, user: true, app: false },
        capabilities: {
          notify: true,
          readThreads: true,
          readUnjoined: true,
          search: true,
          post: true,
          startFromSlack: false,
          readDirectMessages: false,
        },
        directMessages: { blockedBy: 'scopes' },
      },
    });
    const bundle = JSON.parse((await secrets.get(SLACK_SIGN_IN_SECRET))!) as Record<string, string>;
    expect(bundle.accessToken).toBe(oauth().access);
    expect(bundle.refreshToken).toBe(oauth().refresh);
    const { rows } = await t.db.query(
      'SELECT method, state, user_scopes, access_expires_at, refresh_expires_at FROM slack_connections',
    );
    expect(rows[0]).toMatchObject({ method: 'sign_in', state: 'connected' });
    expect(rows[0].user_scopes).toContain('chat:write');
    expect((rows[0].access_expires_at as Date).getTime()).toBe(clock + 43_200_000);
    expect((rows[0].refresh_expires_at as Date).getTime()).toBe(clock + 30 * 86_400_000);
    const stored = await databaseText(t);
    const shown =
      JSON.stringify(status) + JSON.stringify(signIn.state()) + JSON.stringify(logs.mock.calls);
    for (const secret of [oauth().access!, oauth().refresh!]) {
      expect(stored).not.toContain(secret);
      expect(shown).not.toContain(secret);
    }
    expect(stored).toContain('"method":"sign_in"');
    logs.mockRestore();
  });

  it('exchanges the code with the verifier and never a client secret', async () => {
    const signIn = flowOf();
    const flow = await signIn.start({ directMessages: false, replace: false });
    const challenge = new URL(flow.authorizeUrl!).searchParams.get('code_challenge');
    await signIn.complete(oauth().authorize(flow.authorizeUrl!));

    expect(oauth().requests).toHaveLength(1);
    const body = oauth().requests[0]!;
    expect(Object.keys(body).sort()).toEqual([
      'client_id',
      'code',
      'code_verifier',
      'redirect_uri',
    ]);
    expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(body.code_verifier).not.toBe(challenge);
    expect(JSON.stringify(oauth().requests)).not.toMatch(/secret/i);
  });

  it('refuses a callback with a wrong or missing state and keeps waiting', async () => {
    const signIn = flowOf();
    const flow = await signIn.start({ directMessages: false, replace: false });
    const good = oauth().authorize(flow.authorizeUrl!);
    const code = new URL(good).searchParams.get('code');

    for (const url of [
      `spark-outpost-dev://slack/callback?code=${code}&state=someone-elses-state`,
      `spark-outpost-dev://slack/callback?code=${code}`,
    ]) {
      await expect(signIn.complete(url)).rejects.toThrow(SIGN_IN_WRONG_STATE);
    }
    await expect(signIn.complete('https://evil.example/?code=1&state=2')).rejects.toThrow(
      /isn't a Slack sign-in link/,
    );
    expect(oauth().requests).toHaveLength(0);
    expect(signIn.state().status).toBe('waiting');
    expect((await slackStatus(deps())).connection).toBeNull();

    expect(await signIn.complete(good)).toMatchObject({ status: 'connected' });
  });

  it('uses a state once: a replayed callback is refused and exchanges nothing', async () => {
    const signIn = flowOf();
    const flow = await signIn.start({ directMessages: false, replace: false });
    const callback = oauth().authorize(flow.authorizeUrl!);
    await signIn.complete(callback);

    await expect(signIn.complete(callback)).rejects.toThrow(SIGN_IN_WRONG_STATE);
    expect(oauth().requests).toHaveLength(1);
  });

  it('says so when Slack refuses a code that was already used', async () => {
    const first = flowOf();
    const started = await first.start({ directMessages: false, replace: false });
    const callback = new URL(oauth().authorize(started.authorizeUrl!));
    await first.complete(callback.toString());
    await removeSlack(deps());

    const second = flowOf();
    const again = await second.start({ directMessages: false, replace: false });
    callback.searchParams.set('state', new URL(again.authorizeUrl!).searchParams.get('state')!);
    const flow = await second.complete(callback.toString());

    expect(flow).toMatchObject({ status: 'failed' });
    expect(flow.message).toMatch(/used already or run out/);
    expect((await slackStatus(deps())).connection).toBeNull();
  });

  it('reports a sign-in denied in Slack, cancelled in Spark, and one that ran out of time', async () => {
    const denied = flowOf();
    oauth().deny = 'access_denied';
    const flow = await denied.start({ directMessages: false, replace: false });
    expect(await denied.complete(oauth().authorize(flow.authorizeUrl!))).toMatchObject({
      status: 'failed',
      message: SIGN_IN_DENIED,
    });
    oauth().deny = null;

    const cancelled = flowOf();
    const waiting = await cancelled.start({ directMessages: false, replace: false });
    expect(cancelled.cancel()).toMatchObject({ status: 'idle', authorizeUrl: null });
    await expect(cancelled.complete(oauth().authorize(waiting.authorizeUrl!))).rejects.toThrow(
      SIGN_IN_WRONG_STATE,
    );

    const slow = flowOf();
    const late = await slow.start({ directMessages: false, replace: false });
    clock += SIGN_IN_TTL_MS + 1;
    expect(slow.state()).toMatchObject({ status: 'failed', message: SIGN_IN_TIMED_OUT });
    expect(slow.state().message).toMatch(/admin to approve/);
    await expect(slow.complete(oauth().authorize(late.authorizeUrl!))).rejects.toThrow(
      SIGN_IN_WRONG_STATE,
    );
    expect(oauth().requests).toHaveLength(0);
    expect((await slackStatus(deps())).connection).toBeNull();
  });

  it('asks for the direct message scopes only when the user wants direct messages', async () => {
    await signInToSlack(deps(), stub);
    expect((await slackStatus(deps())).connection?.directMessages.blockedBy).toBe('scopes');

    await signInToSlack(deps(), stub, { directMessages: true });

    const status = await slackStatus(deps());
    expect(status.connection?.directMessages).toMatchObject({ blockedBy: null, missingScopes: [] });
  });

  it('disconnect revokes the token with Slack and removes it and the connection', async () => {
    await signInToSlack(deps(), stub);
    const access = oauth().access!;

    const after = await removeSlack(deps());

    expect(after).toEqual({ connection: null, signInAvailable: true });
    expect(oauth().revoked).toEqual([access]);
    expect(await secrets.get(SLACK_SIGN_IN_SECRET)).toBeNull();
    expect((await t.db.query('SELECT 1 FROM slack_connections')).rows).toEqual([]);
  });
});

describe('one Slack connection at a time', () => {
  it('switching from your own app to sign-in needs a confirmation, then replaces the tokens and keeps the allow-list', async () => {
    await saveSlack(deps(), ALL_SLACK_TOKENS);
    await allowSlackChannels(deps(), { channels: [{ id: 'C0ENG', projectId: null }] });

    await expect(flowOf().start({ directMessages: false, replace: false })).rejects.toThrow(
      /Confirm the switch/,
    );
    expect(await secrets.get('slack:bot')).toBe(SLACK_BOT_TOKEN);

    await signInToSlack(deps(), stub, { replace: true });

    const status = await slackStatus(deps());
    expect(status.connection).toMatchObject({
      method: 'sign_in',
      tokens: { bot: false, user: true, app: false },
      allowedChannels: [{ id: 'C0ENG' }],
    });
    for (const id of ['slack:bot', 'slack:user', 'slack:app'] as const) {
      expect(await secrets.get(id)).toBeNull();
    }
  });

  it('keeps the own-app connection when the sign-in is abandoned', async () => {
    await saveSlack(deps(), ALL_SLACK_TOKENS);
    const signIn = flowOf();
    await signIn.start({ directMessages: false, replace: true });
    signIn.cancel();

    expect((await slackStatus(deps())).connection).toMatchObject({
      method: 'own_app',
      tokens: { bot: true, user: true, app: true },
    });
  });

  it('switching from sign-in to your own app needs a confirmation, then revokes and removes the sign-in', async () => {
    await signInToSlack(deps(), stub);
    const access = oauth().access!;

    await expect(saveSlack(deps(), ALL_SLACK_TOKENS)).rejects.toThrow(/Confirm the switch/);
    expect((await slackStatus(deps())).connection?.method).toBe('sign_in');

    const status = await saveSlack(deps(), ALL_SLACK_TOKENS, { replace: true });

    expect(status.connection).toMatchObject({
      method: 'own_app',
      state: 'connected',
      botName: 'spark',
      tokens: { bot: true, user: true, app: true },
      capabilities: { startFromSlack: true },
    });
    expect(oauth().revoked).toEqual([access]);
    expect(await secrets.get(SLACK_SIGN_IN_SECRET)).toBeNull();
  });

  it('a connection saved before sign-in existed is an own-app connection and keeps working', async () => {
    await saveSlack(deps(), ALL_SLACK_TOKENS);
    await t.db.query(
      `UPDATE slack_connections SET method = DEFAULT, state = DEFAULT, generation = DEFAULT`,
    );

    const status = await slackStatus({ ...deps(), signIn: null });

    expect(status).toMatchObject({
      signInAvailable: false,
      connection: { method: 'own_app', state: 'connected', capabilities: { startFromSlack: true } },
    });
  });
});

describe('Slack sign-in routes', () => {
  const app = (configured = true) =>
    createTestApp(t, {
      secrets,
      fetch,
      slackApiUrl: stub.apiUrl,
      slackSignIn: configured ? SLACK_SIGN_IN : null,
    });

  it('starts, completes from the callback link and reports the connection, without echoing tokens', async () => {
    const api = app();
    const started = await request(api).post('/api/slack/sign-in').set(LOCAL_HEADERS).send({});
    expect(started.body).toMatchObject({ status: 'waiting' });

    const wrong = await request(api)
      .post('/api/slack/sign-in/callback')
      .set(LOCAL_HEADERS)
      .send({ url: 'spark-outpost-dev://slack/callback?code=abc&state=nope' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe(SIGN_IN_WRONG_STATE);

    const done = await request(api)
      .post('/api/slack/sign-in/callback')
      .set(LOCAL_HEADERS)
      .send({ url: oauth().authorize(started.body.authorizeUrl as string) });
    expect(done.body).toMatchObject({ status: 'connected' });

    const status = await request(api).get('/api/slack').set(LOCAL_HEADERS);
    const flow = await request(api).get('/api/slack/sign-in').set(LOCAL_HEADERS);
    expect(status.body.connection).toMatchObject({ method: 'sign_in', team: 'Acme' });
    const shown = JSON.stringify([started.body, done.body, status.body, flow.body]);
    expect(shown).not.toContain(oauth().access);
    expect(shown).not.toContain(oauth().refresh);
    expect(shown).not.toContain(oauth().requests[0]!.code_verifier);

    const replace = await request(api)
      .put('/api/slack/connection')
      .set(LOCAL_HEADERS)
      .send(ALL_SLACK_TOKENS);
    expect(replace.status).toBe(409);
    const replaced = await request(api)
      .put('/api/slack/connection')
      .set(LOCAL_HEADERS)
      .send({ ...ALL_SLACK_TOKENS, replace: true });
    expect(replaced.body.connection).toMatchObject({ method: 'own_app' });

    const back = await request(api).post('/api/slack/sign-in').set(LOCAL_HEADERS).send({});
    expect(back.status).toBe(409);
  });

  it('hides sign-in and changes nothing else without a client ID', async () => {
    const api = app(false);

    const status = await request(api).get('/api/slack').set(LOCAL_HEADERS);
    const flow = await request(api).get('/api/slack/sign-in').set(LOCAL_HEADERS);
    const start = await request(api).post('/api/slack/sign-in').set(LOCAL_HEADERS).send({});
    const callback = await request(api)
      .post('/api/slack/sign-in/callback')
      .set(LOCAL_HEADERS)
      .send({ url: 'spark-outpost-dev://slack/callback?code=a&state=b' });
    const ownApp = await request(api)
      .put('/api/slack/connection')
      .set(LOCAL_HEADERS)
      .send(ALL_SLACK_TOKENS);

    expect(status.body).toEqual({ connection: null, signInAvailable: false });
    expect(flow.body).toMatchObject({ status: 'idle' });
    expect(start.status).toBe(400);
    expect(callback.status).toBe(400);
    expect(ownApp.body.connection).toMatchObject({ method: 'own_app', team: 'Acme' });
    expect(stub.slack.calls).not.toContain('oauth.v2.access');
  });
});

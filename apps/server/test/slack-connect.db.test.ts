import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { allowSlackChannels, listSlackChannels } from '../src/slack/channels.ts';
import {
  changeSlackSettings,
  removeSlack,
  saveSlack,
  slackStatus,
} from '../src/slack/connection.ts';
import { SlackApiError, SlackChannelNotAllowedError } from '../src/slack/web-api.ts';
import { LOCAL_HEADERS, createTestApp } from './app-support.ts';
import { SLACK_APP_TOKEN, SLACK_BOT_TOKEN, SLACK_ME, SLACK_USER_TOKEN } from './fake-slack.ts';
import {
  ALL_SLACK_TOKENS,
  databaseText,
  slackDeps,
  startSlackStub,
  type SlackStub,
} from './slack-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let stub: SlackStub;
let secrets: SecretStore;
const deps = () => slackDeps(t, stub, secrets);
const TOKENS = [SLACK_BOT_TOKEN, SLACK_USER_TOKEN, SLACK_APP_TOKEN];

beforeEach(async () => {
  t = await createTestDb();
  stub = await startSlackStub();
  secrets = memorySecretStore();
});

afterEach(async () => {
  await stub.close();
  await t.cleanup();
});

describe('connecting Slack', () => {
  it('validates every token, keeps them in the keychain only and reports what each allows', async () => {
    const logs = vi.spyOn(console, 'error');
    const status = await saveSlack(deps(), ALL_SLACK_TOKENS);

    expect(status.connection).toMatchObject({
      team: 'Acme',
      botName: 'spark',
      member: { id: SLACK_ME, name: 'Alex Example' },
      tokens: { bot: true, user: true, app: true },
      capabilities: {
        notify: true,
        readThreads: true,
        readUnjoined: true,
        search: true,
        post: true,
        startFromSlack: true,
      },
      allowedChannels: [],
      lastProblem: null,
    });
    expect(await secrets.get('slack:bot')).toBe(SLACK_BOT_TOKEN);
    expect(await secrets.get('slack:user')).toBe(SLACK_USER_TOKEN);
    expect(await secrets.get('slack:app')).toBe(SLACK_APP_TOKEN);
    const stored = await databaseText(t);
    const shown = JSON.stringify(status) + JSON.stringify(logs.mock.calls);
    for (const token of TOKENS) {
      expect(stored).not.toContain(token);
      expect(shown).not.toContain(token);
    }
    expect(stored).toContain('"action":"connect"');
    logs.mockRestore();
  });

  it('works with only a bot token and says what is missing', async () => {
    const status = await saveSlack(deps(), { botToken: SLACK_BOT_TOKEN });

    expect(status.connection).toMatchObject({
      member: null,
      tokens: { bot: true, user: false, app: false },
      capabilities: { notify: false, search: false, readUnjoined: false, startFromSlack: false },
    });
    const withMember = await changeSlackSettings(deps(), { memberId: SLACK_ME });
    expect(withMember.connection).toMatchObject({
      member: { id: SLACK_ME, name: 'Alex Example' },
      capabilities: { notify: true },
    });
  });

  it('refuses a rejected token and saves nothing', async () => {
    const attempt = saveSlack(deps(), { botToken: 'xoxb-0000000000-notarealtoken' });

    await expect(attempt).rejects.toThrow(/rejected this token/);
    expect(await secrets.get('slack:bot')).toBeNull();
    expect((await slackStatus(deps())).connection).toBeNull();
    const { rows } = await t.db.query("SELECT outcome FROM slack_events WHERE action = 'connect'");
    expect(rows).toEqual([{ outcome: 'failed' }]);
    expect(await databaseText(t)).not.toContain('notarealtoken');
  });

  it('refuses a user token in the bot field', async () => {
    await expect(
      saveSlack(deps(), { botToken: SLACK_USER_TOKEN.replace('xoxp', 'xoxb') }),
    ).rejects.toBeInstanceOf(SlackApiError);
  });

  it('pages the channel list and keeps an allow-list with a project per channel', async () => {
    await saveSlack(deps(), ALL_SLACK_TOKENS);
    const first = await listSlackChannels(deps(), null);
    const second = await listSlackChannels(deps(), first.nextCursor);

    expect(first.channels.map((channel) => channel.name)).toEqual(['eng', 'web-team', 'random']);
    expect(first.nextCursor).not.toBeNull();
    expect(second.channels.map((channel) => channel.name)).toEqual(['leadership', 'ops']);
    expect(second.nextCursor).toBeNull();

    const allowed = await allowSlackChannels(deps(), {
      channels: [
        { id: 'C0ENG', projectId: null },
        { id: 'C0OPS', projectId: null },
      ],
    });
    expect(allowed.connection?.allowedChannels).toEqual([
      { id: 'C0ENG', name: 'eng', isPrivate: false, projectId: null },
      { id: 'C0OPS', name: 'ops', isPrivate: true, projectId: null },
    ]);

    await changeSlackSettings(deps(), { defaultChannelId: 'C0OPS' });
    const narrowed = await allowSlackChannels(deps(), {
      channels: [{ id: 'C0ENG', projectId: null }],
    });
    expect(narrowed.connection?.allowedChannels.map((channel) => channel.id)).toEqual(['C0ENG']);
    expect(narrowed.connection?.settings.defaultChannelId).toBeNull();
  });

  it('only takes an allowed channel as the updates or notifications channel', async () => {
    await saveSlack(deps(), ALL_SLACK_TOKENS);

    await expect(
      changeSlackSettings(deps(), { defaultChannelId: 'C0RANDOM' }),
    ).rejects.toBeInstanceOf(SlackChannelNotAllowedError);
  });

  it('merges notification choices and keeps the rest', async () => {
    await saveSlack(deps(), ALL_SLACK_TOKENS);
    const changed = await changeSlackSettings(deps(), {
      notify: { finished: false },
      quietWhenFocused: false,
    });

    expect(changed.connection?.settings).toMatchObject({
      notify: { needs_you: true, finished: false, failed: true, pr_opened: true, flag: false },
      quietWhenFocused: false,
      postUpdatesToThread: true,
    });
  });

  it('disconnect removes the keychain entries, the allow-list and the connection', async () => {
    await saveSlack(deps(), ALL_SLACK_TOKENS);
    await allowSlackChannels(deps(), { channels: [{ id: 'C0ENG', projectId: null }] });

    const after = await removeSlack(deps());

    expect(after.connection).toBeNull();
    for (const id of ['slack:bot', 'slack:user', 'slack:app'] as const) {
      expect(await secrets.get(id)).toBeNull();
    }
    const { rows } = await t.db.query('SELECT 1 FROM slack_channels');
    expect(rows).toEqual([]);
  });
});

describe('Slack routes', () => {
  const app = () => createTestApp(t, { secrets, fetch, slackApiUrl: stub.apiUrl });

  it('connects, lists channels, saves settings and disconnects without echoing tokens', async () => {
    const connected = await request(app())
      .put('/api/slack/connection')
      .set(LOCAL_HEADERS)
      .send(ALL_SLACK_TOKENS);
    expect(connected.status).toBe(200);
    expect(connected.body.connection.team).toBe('Acme');
    for (const token of TOKENS) expect(JSON.stringify(connected.body)).not.toContain(token);

    const channels = await request(app()).get('/api/slack/channels').set(LOCAL_HEADERS);
    expect(channels.body.channels).toHaveLength(3);

    const allowed = await request(app())
      .post('/api/slack/channels/C0ENG/allow')
      .set(LOCAL_HEADERS)
      .send({});
    expect(allowed.body.connection.allowedChannels).toHaveLength(1);

    const settings = await request(app())
      .patch('/api/slack/settings')
      .set(LOCAL_HEADERS)
      .send({ notify: { flag: true }, defaultChannelId: 'C0ENG' });
    expect(settings.body.connection.settings).toMatchObject({
      notify: { flag: true },
      defaultChannelId: 'C0ENG',
    });

    const test = await request(app()).post('/api/slack/test').set(LOCAL_HEADERS).send({});
    expect(test.body).toEqual({ sentTo: 'you, as a direct message' });
    expect(stub.slack.posted.at(-1)).toMatchObject({ channel: SLACK_ME });

    const gone = await request(app()).delete('/api/slack/connection').set(LOCAL_HEADERS);
    expect(gone.body).toEqual({ connection: null });
  });

  it('answers 400 for a rejected token and a malformed one', async () => {
    const rejected = await request(app())
      .put('/api/slack/connection')
      .set(LOCAL_HEADERS)
      .send({ botToken: 'xoxb-0000000000-notarealtoken' });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toMatch(/rejected this token/);

    const malformed = await request(app())
      .put('/api/slack/connection')
      .set(LOCAL_HEADERS)
      .send({ botToken: 'not-a-token' });
    expect(malformed.status).toBe(400);
  });
});

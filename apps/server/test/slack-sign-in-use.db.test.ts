import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveSlackChatThread } from '../src/persistence/slack.ts';
import { SLACK_SIGN_IN_SECRET, memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { allowSlackChannels } from '../src/slack/channels.ts';
import {
  changeSlackSettings,
  openSlack,
  requireSlack,
  slackStatus,
} from '../src/slack/connection.ts';
import { startSlackNotifier } from '../src/slack/notifier.ts';
import { startSlackSocket } from '../src/slack/socket.ts';
import { SlackStartRefusedError, startFromSlack } from '../src/slack/start.ts';
import { sendTestNotification } from '../src/slack/test-message.ts';
import { readSlackThread, requireSlackRef } from '../src/slack/thread.ts';
import { SLACK_SIGN_IN_AGAIN, slackCall } from '../src/slack/web-api.ts';
import { SLACK_ME, slackLink } from './fake-slack.ts';
import {
  confirmCard,
  pendingCard,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import {
  SLACK_SIGN_IN,
  databaseText,
  signInToSlack,
  slackDeps,
  startSlackStub,
  type SlackStub,
} from './slack-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let stub: SlackStub;
let secrets: SecretStore;
let recorded: RecordedHooks;
let tools: SparkToolsHarness | null = null;
let clock = Date.parse('2026-10-05T10:00:00Z');

const HOUR = 3_600_000;
const THREAD = slackLink('C0ENG', '1760000000.000100');
const deps = () => ({ ...slackDeps(t, stub, secrets), now: () => clock });
const oauth = () => stub.slack.oauth;
const allow = (ids: string[]) =>
  allowSlackChannels(deps(), { channels: ids.map((id) => ({ id, projectId: null })) });

beforeEach(async () => {
  t = await createTestDb();
  stub = await startSlackStub();
  secrets = memorySecretStore();
  clock = Date.parse('2026-10-05T10:00:00Z');
  recorded = recordedHooks();
  await signInToSlack(deps(), stub);
  await allow(['C0ENG']);
});

afterEach(async () => {
  recorded.stop();
  await tools?.close();
  tools = null;
  await stub.close();
  await t.cleanup();
});

describe('keeping a Slack sign-in fresh', () => {
  it('refreshes shortly before expiry without a client secret and stores the rotated pair', async () => {
    const first = { access: oauth().access!, refresh: oauth().refresh! };
    clock += 12 * HOUR - 60_000;

    const open = await requireSlack(deps());

    expect(open.main.token).toBe(oauth().access);
    expect(open.main.token).not.toBe(first.access);
    const refresh = oauth().requests.at(-1)!;
    expect(Object.keys(refresh).sort()).toEqual(['client_id', 'grant_type', 'refresh_token']);
    expect(refresh).toMatchObject({ grant_type: 'refresh_token', refresh_token: first.refresh });
    const bundle = JSON.parse((await secrets.get(SLACK_SIGN_IN_SECRET))!) as Record<string, string>;
    expect(bundle).toMatchObject({ accessToken: oauth().access, refreshToken: oauth().refresh });
    const { rows } = await t.db.query(
      'SELECT generation, access_expires_at FROM slack_connections',
    );
    expect(rows[0].generation).toBe(2);
    expect((rows[0].access_expires_at as Date).getTime()).toBe(clock + 12 * HOUR);
    expect(await databaseText(t)).not.toContain(oauth().refresh);
  });

  it('refreshes once and retries when Slack says the token expired mid-call', async () => {
    const open = await requireSlack(deps());
    oauth().access = 'xoxe.xoxp-1-rotatedbehindourback';

    const data = await slackCall(open.main, 'auth.test');

    expect(data.user_id).toBe(SLACK_ME);
    expect(oauth().refreshes).toBe(1);
    expect(stub.slack.calls.filter((call) => call === 'auth.test')).toHaveLength(3);
  });

  it('runs one refresh for many callers at once', async () => {
    clock += 12 * HOUR;
    oauth().refreshDelayMs = 40;

    const opened = await Promise.all(Array.from({ length: 6 }, () => openSlack(deps())));

    expect(oauth().refreshes).toBe(1);
    expect(new Set(opened.map((open) => open?.main.token))).toEqual(new Set([oauth().access]));
  });

  it('a caller holding the old token after another process refreshed re-reads instead of refreshing again', async () => {
    const stale = await requireSlack(deps());
    clock += 12 * HOUR;
    await requireSlack(deps());
    expect(oauth().refreshes).toBe(1);

    const renewed = await stale.main.renew!(stale.main.token);

    expect(renewed).toBe(oauth().access);
    expect(oauth().refreshes).toBe(1);
  });

  it('marks the connection as needing sign-in when Slack refuses the refresh token for good', async () => {
    const logs = vi.spyOn(console, 'error');
    const refresh = oauth().refresh!;
    clock += 31 * 24 * HOUR;
    oauth().failRefresh = 'invalid_refresh_token';

    expect(await openSlack(deps())).toBeNull();
    await expect(requireSlack(deps())).rejects.toThrow(SLACK_SIGN_IN_AGAIN);

    const status = await slackStatus(deps());
    expect(status.connection).toMatchObject({
      method: 'sign_in',
      state: 'needs_sign_in',
      capabilities: { notify: false, readThreads: false, post: false, search: false },
    });
    await expect(readSlackThread(deps(), requireSlackRef(THREAD))).rejects.toThrow(
      SLACK_SIGN_IN_AGAIN,
    );
    const { rows } = await t.db.query(
      "SELECT outcome, detail FROM slack_events WHERE action = 'refresh'",
    );
    expect(rows).toEqual([{ outcome: 'failed', detail: { reason: 'invalid_refresh_token' } }]);
    expect(oauth().requests.filter((body) => body.grant_type === 'refresh_token')).toHaveLength(1);
    expect((await databaseText(t)) + JSON.stringify(logs.mock.calls)).not.toContain(refresh);
    logs.mockRestore();

    oauth().failRefresh = null;
    await signInToSlack(deps(), stub);
    expect((await slackStatus(deps())).connection).toMatchObject({ state: 'connected' });
  });

  it('keeps the connection when Slack is only unreachable or busy', async () => {
    clock += 12 * HOUR - 60_000;
    oauth().failRefresh = 'ratelimited';

    const open = await requireSlack(deps());

    expect(open.main.token).toBe(oauth().access);
    expect((await slackStatus(deps())).connection?.state).toBe('connected');
  });
});

describe('what a Slack sign-in can do', () => {
  async function chatIn(message: string, mode: string | null = null) {
    const chat = await startChat(t, message);
    if (mode) {
      await t.db.query(`UPDATE runs SET provider = 'claude', used_mode = $2 WHERE id = $1`, [
        chat.runId,
        mode,
      ]);
    }
    tools = await startSparkTools(
      t,
      { ...chat, actions: recorded.hooks },
      { secrets, slackApiUrl: stub.apiUrl, slackSignIn: SLACK_SIGN_IN },
    );
    return chat;
  }

  it('reads an allowed thread as the user, with names, and still refuses other channels', async () => {
    const read = await readSlackThread(deps(), requireSlackRef(THREAD));

    expect(read.preview).toMatchObject({ author: 'Sam Ortiz', messages: 3 });
    await expect(
      readSlackThread(deps(), requireSlackRef(slackLink('C0RANDOM', '1760000500.000100'))),
    ).rejects.toThrow(/isn't in your allowed Slack channels/);
    await expect(
      readSlackThread(deps(), requireSlackRef(slackLink('D0SAM', '1760001000.000100'))),
    ).rejects.toThrow(/Let Spark read my direct messages/);
  });

  it('always asks before posting, says it posts as you, and posts with the user token', async () => {
    await chatIn('Post the summary to #eng', 'bypassPermissions');

    const waiting = await tools!.call('spark_slack_post', { channel: '#eng', text: 'Shipped' });

    expect(waiting.json()).toMatchObject({ outcome: 'waiting_for_user' });
    expect(stub.slack.posted).toHaveLength(0);
    const pending = await pendingCard(t);
    expect(pending.title).toBe('Post this to Slack as you? #eng');
    expect(pending.payload.sparkAction).toMatchObject({ action: 'post_slack', asYou: true });

    await confirmCard(t);

    expect(stub.slack.posted).toEqual([
      { channel: 'C0ENG', text: 'Shipped', threadTs: null, token: oauth().access },
    ]);
  });

  it('tells an agent which method is connected and what needs the own app', async () => {
    await chatIn('What can Slack do?');

    const listed = (await tools!.call('spark_slack', { action: 'channels' })).json<{
      method: string;
    }>();
    const connectors = (await tools!.call('spark_connectors', {})).text;

    expect(listed.method).toMatch(/posts as the user/);
    expect(listed.method).toMatch(/starting work from inside Slack .* need your own Slack app/);
    expect(connectors).toContain('"method":"sign_in"');
    expect(connectors).toContain('"startFromSlack":false');
    expect(connectors).not.toContain(oauth().access);
  });

  it('notifies by messaging the user themselves, and never a channel or another member', async () => {
    expect(await sendTestNotification(deps())).toEqual({
      sentTo: 'you, as a message to yourself',
    });
    expect(stub.slack.posted.at(-1)).toMatchObject({ channel: SLACK_ME, token: oauth().access });

    await expect(changeSlackSettings(deps(), { notifyChannelId: 'C0ENG' })).rejects.toThrow(
      /needs your own Slack app/,
    );
    await expect(changeSlackSettings(deps(), { memberId: 'U0SAM' })).rejects.toThrow(
      /needs your own Slack app/,
    );
  });

  it('attempts nothing that needs a bot: no Socket Mode, no start from Slack, no thread replies', async () => {
    const socket = startSlackSocket({ ...deps(), runTarget: () => Promise.reject(new Error()) });
    await socket.refresh();
    expect(socket.state()).toBe('off');
    socket.stop();

    const attempt = startFromSlack(
      { ...deps(), runTarget: () => Promise.reject(new Error('never')) },
      {
        source: 'mention',
        ref: requireSlackRef(THREAD),
        userId: SLACK_ME,
        conversationId: crypto.randomUUID(),
        messageId: crypto.randomUUID(),
        mode: 'build',
        note: '',
      },
    );
    await expect(attempt).rejects.toBeInstanceOf(SlackStartRefusedError);
    await expect(attempt).rejects.toThrow(/needs your own Slack app/);

    const chat = await startChat(t, 'Started from Slack before the switch');
    await saveSlackChatThread(t.db, t.workspaceId, chat.conversationId, {
      channelId: 'C0ENG',
      threadTs: '1760000000.000100',
      permalink: THREAD,
      postUpdates: true,
    });
    await changeSlackSettings(deps(), { notify: { finished: false } });
    const notifier = startSlackNotifier(deps(), { since: new Date(Date.now() - 60_000) });
    await t.db.query(`UPDATE runs SET status = 'succeeded', finished_at = now() WHERE id = $1`, [
      chat.runId,
    ]);
    notifier.changed({ kind: 'run', conversationId: chat.conversationId, runId: chat.runId });
    await notifier.settled();
    await notifier.stop();

    expect(stub.slack.posted).toEqual([]);
    expect(stub.slack.calls).not.toContain('apps.connections.open');
    const { rows } = await t.db.query(
      "SELECT outcome, reason FROM slack_deliveries WHERE kind LIKE 'thread_%'",
    );
    expect(rows).toEqual([{ outcome: 'skipped', reason: 'needs_own_app' }]);
  });
});

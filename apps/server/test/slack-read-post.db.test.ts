import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SPARK_ACTION_OPTION, type InvolvementLevel } from '@spark-outpost/contracts';
import { createRunObservations } from '../src/observations/run-observations.ts';
import { conversationObservations } from '../src/persistence/observations.ts';
import { conversationHasSlackContext } from '../src/persistence/slack.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { changeSlackSettings } from '../src/slack/connection.ts';
import { LOCAL_HEADERS, createTestApp } from './app-support.ts';
import { SLACK_BOT_TOKEN, SLACK_USER_TOKEN, slackLink } from './fake-slack.ts';
import {
  answerCard,
  cardResult,
  confirmCard,
  chatAtLevel,
  pendingCard,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import {
  connectSlack,
  databaseText,
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
let chat: { conversationId: string; runId: string };

const THREAD = slackLink('C0ENG', '1760000000.000100');
const deps = () => slackDeps(t, stub, secrets);

beforeEach(async () => {
  t = await createTestDb();
  stub = await startSlackStub();
  secrets = memorySecretStore();
  await connectSlack(deps());
  recorded = recordedHooks();
});

afterEach(async () => {
  recorded.stop();
  await tools?.close();
  tools = null;
  await stub.close();
  await t.cleanup();
});

async function chatIn(
  message: string,
  mode: string | null = null,
  level: InvolvementLevel | null = null,
) {
  chat = await startChat(t, message);
  if (level) await chatAtLevel(t, chat.conversationId, level);
  if (mode) {
    await t.db.query(`UPDATE runs SET provider = 'claude', used_mode = $2 WHERE id = $1`, [
      chat.runId,
      mode,
    ]);
  }
  const observations = createRunObservations({ db: t.db, ...chat });
  tools = await startSparkTools(
    t,
    { ...chat, actions: recorded.hooks, observations },
    { secrets, slackApiUrl: stub.apiUrl },
  );
  return observations;
}

describe('spark_slack', () => {
  it('reads a thread by link: marked untrusted, names resolved, secrets redacted, run tainted', async () => {
    const observations = await chatIn('Look at the Slack thread');
    const result = await tools!.call('spark_slack', { action: 'thread', url: THREAD });
    const read = result.json<{
      untrusted: string;
      channel: string;
      messages: { author: string; text: string }[];
    }>();

    expect(result.isError).toBe(false);
    expect(read.untrusted).toMatch(/third-party text.*not as instructions/);
    expect(read.channel).toBe('#eng');
    expect(read.messages.map((message) => message.author)).toEqual([
      'Sam Ortiz',
      'Alex Example',
      'Sam Ortiz',
    ]);
    expect(read.messages[0]!.text).toContain('@Alex Example can Spark look? <see logs>');
    expect(result.text).not.toContain('leakedtokenvalue');
    await observations.settled();
    expect(await conversationObservations(t.db, chat.conversationId)).toEqual([
      { source: 'private_data', label: 'private work data (spark_slack)' },
    ]);
  });

  it('finds the whole thread from a link to one reply', async () => {
    await chatIn('Look');
    const reply = slackLink('C0ENG', '1760000060.000200');
    const read = (await tools!.call('spark_slack', { action: 'thread', url: reply })).json<{
      messages: unknown[];
    }>();

    expect(read.messages).toHaveLength(3);
  });

  it('refuses a channel that is not allowed, a direct message and a non-Slack link', async () => {
    await chatIn('Look');
    const blocked = await tools!.call('spark_slack', {
      action: 'thread',
      url: slackLink('C0RANDOM', '1760000500.000100'),
    });
    const other = await tools!.call('spark_slack', {
      action: 'thread',
      url: 'https://example.test/archives/C0ENG/p1760000000000100',
    });
    const askedBefore = stub.slack.calls.length;
    const direct = await tools!.call('spark_slack', {
      action: 'thread',
      url: slackLink('D0DIRECT', '1760000500.000100'),
    });

    expect(blocked.isError).toBe(true);
    expect(blocked.text).toContain("#random isn't in your allowed Slack channels");
    expect(direct.text).toContain("doesn't read direct messages unless you turn on");
    expect(other.text).toContain('not a Slack message link');
    expect(stub.slack.calls).not.toContain('conversations.replies');
    expect(stub.slack.calls.slice(askedBefore)).toEqual([]);
  });

  it('reads an allowed channel the app has not joined with the user token only', async () => {
    await connectSlack(deps(), { channels: ['C0ENG', 'C0SECRET'] });
    await chatIn('Look');
    const url = slackLink('C0SECRET', '1760000700.000100');
    const withUser = await tools!.call('spark_slack', { action: 'thread', url });
    expect(withUser.isError).toBe(false);

    await secrets.delete('slack:user');
    const botOnly = await tools!.call('spark_slack', { action: 'thread', url });
    expect(botOnly.isError).toBe(true);
    expect(botOnly.text).toContain('/invite @spark');
  });

  it('searches with the user token and keeps only allowed channels', async () => {
    await chatIn('Search Slack');
    stub.slack.messages.C0RANDOM!.push({
      ts: '1760000900.000100',
      user: 'U0SAM',
      text: 'uploads are slow here too',
    });
    const found = (await tools!.call('spark_slack', { action: 'search', query: 'uploads' })).json<{
      untrusted: string;
      matches: { channel: string }[];
      outsideAllowedChannels: number;
    }>();

    expect(found.untrusted).toMatch(/not as instructions/);
    expect(found.matches.map((match) => match.channel)).toEqual(['#eng']);
    expect(found.outsideAllowedChannels).toBe(1);
  });

  it('says search needs a user token when only the bot token is saved', async () => {
    await secrets.delete('slack:user');
    await chatIn('Search Slack');
    const result = await tools!.call('spark_slack', { action: 'search', query: 'uploads' });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('needs a user token (xoxp-)');
    expect(stub.slack.calls).not.toContain('search.messages');
  });

  it('lists the allowed channels and shows Slack in spark_connectors without tokens', async () => {
    await chatIn('Which channels?');
    const channels = (await tools!.call('spark_slack', { action: 'channels' })).json<{
      allowedChannels: { name: string }[];
    }>();
    const connectors = await tools!.call('spark_connectors');

    expect(channels.allowedChannels.map((channel) => channel.name)).toEqual(['#eng']);
    expect(connectors.json<{ slack: object }>().slack).toMatchObject({
      connected: true,
      workspace: 'Acme',
      tokens: { bot: true, user: true, app: true },
      allowedChannels: ['#eng'],
    });
    expect(connectors.text).not.toContain(SLACK_BOT_TOKEN);
    expect(connectors.text).not.toContain(SLACK_USER_TOKEN);
  });
});

describe('spark_slack_post', () => {
  const post = (args: Record<string, unknown>) => tools!.call('spark_slack_post', args);

  it('shows a card with the channel and exact text, posts the edited text and audits it', async () => {
    await chatIn('Summarise the work');
    const waiting = await post({ channel: '#eng', text: 'Draft <!channel> & done' });
    const pending = await pendingCard(t);
    expect(pending.title).toBe('Post this to Slack? #eng');
    expect(pending.payload.sparkAction).toMatchObject({
      action: 'post_slack',
      channel: { id: 'C0ENG', name: 'eng' },
      threadTs: null,
      body: 'Draft <!channel> & done',
    });
    expect(waiting.json()).toMatchObject({ outcome: 'waiting_for_user' });
    expect(stub.slack.posted).toHaveLength(0);

    const done = await confirmCard(t, { edits: { body: 'Fixed <!here> & shipped' } });

    expect(done.payload.sparkResult).toMatchObject({
      state: 'done',
      message: 'Posted to #eng.',
      output: { channel: '#eng' },
    });
    expect(stub.slack.posted).toEqual([
      {
        channel: 'C0ENG',
        text: 'Fixed &lt;!here&gt; &amp; shipped',
        threadTs: null,
        token: SLACK_BOT_TOKEN,
      },
    ]);
    const { rows } = await t.db.query(
      "SELECT outcome, channel_id, detail FROM slack_events WHERE action = 'post'",
    );
    expect(rows).toEqual([
      {
        outcome: 'succeeded',
        channel_id: 'C0ENG',
        detail: { via: 'spark_tools', length: 23, thread: false },
      },
    ]);
    expect(JSON.stringify(recorded.audited)).toContain('spark/post_slack');
  });

  it('posts nothing when the user declines', async () => {
    await chatIn('Summarise the work');
    await post({ channel: 'eng', text: 'Hello' });
    const card = await answerCard(t, SPARK_ACTION_OPTION.decline);
    await cardResult(t, card.id);

    expect(stub.slack.posted).toHaveLength(0);
  });

  it('posts at once in Auto, in Full auto, and in Accept edits when the user asked', async () => {
    await chatIn('Do the work', 'auto');
    expect((await post({ channel: 'eng', text: 'From auto' })).json()).toMatchObject({
      outcome: 'done',
    });
    await tools!.close();

    await chatIn('Do the work', 'default', 'full-auto');
    expect((await post({ channel: 'eng', text: 'From full auto' })).json()).toMatchObject({
      outcome: 'done',
    });
    await tools!.close();

    await chatIn('Fix it and post an update to the Slack channel', 'acceptEdits', 'hands-off');
    expect((await post({ channel: 'eng', text: 'Asked for' })).json()).toMatchObject({
      outcome: 'done',
    });
    await tools!.close();

    await chatIn('Fix it', 'acceptEdits', 'hands-off');
    expect((await post({ channel: 'eng', text: 'Not asked' })).json()).toMatchObject({
      outcome: 'waiting_for_user',
    });
    expect(stub.slack.posted.map((entry) => entry.text)).toEqual([
      'From auto',
      'From full auto',
      'Asked for',
    ]);
  });

  it('asks first after the run read Slack, even in Auto', async () => {
    const observations = await chatIn('Do the work', 'auto');
    await tools!.call('spark_slack', { action: 'thread', url: THREAD });
    await observations.settled();
    const result = await post({ channel: 'eng', text: 'Copied from the thread' });

    expect(result.json()).toMatchObject({ outcome: 'waiting_for_user' });
    expect((await pendingCard(t)).payload.observed).toEqual(['private work data (spark_slack)']);
    expect(stub.slack.posted).toHaveLength(0);
  });

  it('replies in a thread by link, and redacts secrets before the card and the post', async () => {
    await chatIn('Do the work', 'auto');
    const reply = slackLink('C0ENG', '1760000060.000200', '1760000000.000100');
    await post({ threadUrl: reply, text: 'Key is xoxb-1234567890-abcdefghijkl' });

    expect(stub.slack.posted).toHaveLength(1);
    expect(stub.slack.posted[0]).toMatchObject({ channel: 'C0ENG', threadTs: '1760000000.000100' });
    expect(stub.slack.posted[0]!.text).not.toContain('xoxb-1234567890');
    expect(await databaseText(t)).not.toContain('xoxb-1234567890');
  });

  it('refuses channels that are not allowed and says how to invite the app', async () => {
    await chatIn('Do the work', 'auto');
    const blocked = await post({ channel: 'random', text: 'Hi' });
    expect(blocked.isError).toBe(true);
    expect(blocked.text).toContain("isn't in your allowed Slack channels");

    await connectSlack(deps(), { channels: ['C0ENG', 'C0RANDOM'] });
    const notInvited = await post({ channel: 'random', text: 'Hi' });
    expect(notInvited.isError).toBe(true);
    expect(notInvited.text).toContain('/invite @spark');
    expect(stub.slack.posted).toHaveLength(0);
  });

  it('falls back to the default updates channel, and asks for a place without one', async () => {
    await chatIn('Do the work', 'auto');
    const missing = await post({ text: 'Where?' });
    expect(missing.text).toContain('no default channel for updates');

    await changeSlackSettings(deps(), { defaultChannelId: 'C0ENG' });
    expect((await post({ text: 'To the default' })).json()).toMatchObject({ outcome: 'done' });
    expect(stub.slack.posted.at(-1)).toMatchObject({ channel: 'C0ENG', threadTs: null });
  });

  it('waits out a rate limit on chat.postMessage', async () => {
    await chatIn('Do the work', 'auto');
    stub.slack.rateLimitNext = 2;
    const result = await post({ channel: 'eng', text: 'Eventually' });

    expect(result.json()).toMatchObject({ outcome: 'done' });
    expect(stub.slack.calls.filter((call) => call === 'chat.postMessage')).toHaveLength(3);
  });
});

describe('a Slack link in the composer', () => {
  const app = () => createTestApp(t, { secrets, fetch, slackApiUrl: stub.apiUrl });

  it('becomes a capped, untrusted text attachment and taints the chat that sends it', async () => {
    const response = await request(app())
      .post('/api/slack/context')
      .set(LOCAL_HEADERS)
      .send({ url: THREAD });

    expect(response.status).toBe(201);
    expect(response.body.preview).toMatchObject({
      channel: { id: 'C0ENG', name: 'eng' },
      author: 'Sam Ortiz',
      messages: 3,
      truncated: false,
    });
    expect(response.body.attachment).toMatchObject({
      name: 'Slack thread in eng.md',
      kind: 'text',
    });
    const file = await request(app())
      .get(`/api/attachments/${response.body.attachment.id}/content`)
      .set(LOCAL_HEADERS);
    expect(file.text).toContain('third-party text written by other people');
    expect(file.text).toContain('Alex Example: Repro');
    expect(file.text).not.toContain('leakedtokenvalue');

    const conversationId = crypto.randomUUID();
    expect(await conversationHasSlackContext(t.db, conversationId)).toBe(false);
    await sendUserMessage(
      t.db,
      conversationId,
      {
        id: crypto.randomUUID(),
        content: 'Use this',
        attachmentIds: [response.body.attachment.id],
      },
      { provider: 'fake' },
      t.workspaceId,
    );
    expect(await conversationHasSlackContext(t.db, conversationId)).toBe(true);
  });

  it('caps a long thread', async () => {
    stub.slack.messages.C0ENG![0]!.text = 'x'.repeat(20_000);
    const response = await request(app())
      .post('/api/slack/context')
      .set(LOCAL_HEADERS)
      .send({ url: THREAD });

    expect(response.body.preview.truncated).toBe(true);
    expect(response.body.attachment.size).toBeLessThan(13_500);
  });

  it('answers 409 with the channel for a channel that is not allowed, then works once allowed', async () => {
    const url = slackLink('C0WEB', '1760000000.000100');
    stub.slack.messages.C0WEB = [{ ts: '1760000000.000100', user: 'U0SAM', text: 'Hello web' }];
    const blocked = await request(app())
      .post('/api/slack/context')
      .set(LOCAL_HEADERS)
      .send({ url });

    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({
      code: 'slack_channel_not_allowed',
      channel: { id: 'C0WEB', name: 'web-team' },
    });

    await request(app()).post('/api/slack/channels/C0WEB/allow').set(LOCAL_HEADERS).send({});
    const allowed = await request(app())
      .post('/api/slack/context')
      .set(LOCAL_HEADERS)
      .send({ url });
    expect(allowed.status).toBe(201);
  });

  it('answers 400 for a link that is not a Slack message', async () => {
    const response = await request(app())
      .post('/api/slack/context')
      .set(LOCAL_HEADERS)
      .send({ url: 'https://example.test/x' });

    expect(response.status).toBe(400);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRunObservations } from '../src/observations/run-observations.ts';
import { turnObservations } from '../src/persistence/observations.ts';
import { conversationReadSlackDms, slackChatThread } from '../src/persistence/slack.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { changeSlackSettings } from '../src/slack/connection.ts';
import { allowSlackDms } from '../src/slack/direct.ts';
import { DIRECT_CHAT_TITLE, startSlackNotifier } from '../src/slack/notifier.ts';
import { SlackStartRefusedError, startFromSlack } from '../src/slack/start.ts';
import { SLACK_BOT_TOKEN, SLACK_ME, slackLink } from './fake-slack.ts';
import {
  confirmCard,
  fullAutoChat,
  pendingCard,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { connectSlack, slackDeps, startSlackStub, type SlackStub } from './slack-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let stub: SlackStub;
let secrets: SecretStore;
let recorded: RecordedHooks;
let tools: SparkToolsHarness | null = null;
let chat: { conversationId: string; runId: string };

const SAM = slackLink('D0SAM', '1760001000.000100');
const KIM = slackLink('D0KIM', '1760003000.000100');
const CREW = slackLink('G0CREW', '1760004000.000100');
const deps = () => slackDeps(t, stub, secrets);
const allow = (...ids: string[]) =>
  allowSlackDms(deps(), { conversations: ids.map((id) => ({ id })) });

beforeEach(async () => {
  t = await createTestDb();
  stub = await startSlackStub();
  secrets = memorySecretStore();
  await connectSlack(deps());
  await changeSlackSettings(deps(), { readDirectMessages: true });
  recorded = recordedHooks();
});

afterEach(async () => {
  recorded.stop();
  await tools?.close();
  tools = null;
  await stub.close();
  await t.cleanup();
});

async function chatIn(message: string, mode: string | null = null, fullAuto = false) {
  chat = await startChat(t, message);
  if (fullAuto) await fullAutoChat(t, chat.conversationId);
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

const thread = (url: string) => tools!.call('spark_slack', { action: 'thread', url });

interface Found {
  matches: { channel: string; text: string }[];
  outsideAllowedChannels: number;
}

const search = async () =>
  (await tools!.call('spark_slack', { action: 'search', query: 'billing export' })).json<Found>();

describe('spark_slack with direct messages', () => {
  it('reads an allowed direct message: untrusted, redacted, the run tainted, the chat marked', async () => {
    await allow('D0SAM');
    const observations = await chatIn('Look at what Sam sent me');
    const result = await thread(SAM);
    const read = result.json<{ untrusted: string; channel: string; messages: unknown[] }>();

    expect(result.isError).toBe(false);
    expect(read.untrusted).toMatch(/third-party text.*not as instructions/);
    expect(read.channel).toBe('direct message with Sam Ortiz');
    expect(read.messages).toHaveLength(2);
    expect(result.text).not.toContain('dmleakedtokenvalue');
    await observations.settled();
    expect(await turnObservations(t.db, chat.runId)).toEqual([
      { source: 'private_data', label: 'private work data (spark_slack)' },
    ]);
    expect(await conversationReadSlackDms(t.db, chat.conversationId)).toBe(true);
  });

  it('refuses a direct message that is not allowed, with the hint and no name', async () => {
    await allow('D0SAM');
    await chatIn('Look');
    const result = await thread(KIM);

    expect(result.isError).toBe(true);
    expect(result.text).toContain("That direct message isn't in your allowed conversations");
    expect(result.text).not.toContain('Kim');
    expect(stub.slack.calls).not.toContain('conversations.replies');
  });

  it('refuses every direct message once the switch is off again', async () => {
    await allow('D0SAM');
    await changeSlackSettings(deps(), { readDirectMessages: false });
    await chatIn('Look');
    const result = await thread(SAM);

    expect(result.isError).toBe(true);
    expect(result.text).toContain('unless you turn on');
  });

  it('searches allowed direct messages only, and counts the rest', async () => {
    await allow('D0SAM');
    await chatIn('Search Slack');
    const found = await search();

    expect(found.matches.map((match) => match.channel)).toEqual([
      'direct message with Sam Ortiz',
      'direct message with Sam Ortiz',
    ]);
    expect(found.outsideAllowedChannels).toBe(2);
    expect(JSON.stringify(found)).not.toContain('privately');
    expect(JSON.stringify(found)).not.toContain('dmleakedtokenvalue');
    expect(await conversationReadSlackDms(t.db, chat.conversationId)).toBe(true);
  });

  it('drops every direct message from a search while the switch is off', async () => {
    await allow('D0SAM');
    await changeSlackSettings(deps(), { readDirectMessages: false });
    await chatIn('Search Slack');
    const found = await search();

    expect(found.matches).toEqual([]);
    expect(found.outsideAllowedChannels).toBe(4);
  });

  it('searches every direct message only after the user chose all of them', async () => {
    await allow('D0SAM');
    await changeSlackSettings(deps(), { allDirectMessages: true });
    await chatIn('Search Slack');
    const found = await search();

    expect(found.matches.map((match) => match.channel).sort()).toEqual([
      'a direct message',
      'a direct message',
      'direct message with Sam Ortiz',
      'direct message with Sam Ortiz',
    ]);
    expect(found.outsideAllowedChannels).toBe(0);
  });

  it('lists allowed direct messages apart from channels and names no others', async () => {
    await allow('D0SAM');
    await chatIn('Which channels?');
    const result = await tools!.call('spark_slack', { action: 'channels' });
    const listed = result.json<{
      allowedChannels: { name: string }[];
      directMessages: { allowed: { id: string; name: string }[]; note: string };
    }>();

    expect(listed.allowedChannels.map((channel) => channel.name)).toEqual(['#eng']);
    expect(listed.directMessages.allowed).toEqual([
      { id: 'D0SAM', name: 'direct message with Sam Ortiz' },
    ]);
    expect(listed.directMessages.note).toBe('Spark reads only these direct messages.');
    expect(result.text).not.toContain('Kim');
    expect(stub.slack.calls).not.toContain('conversations.list');
  });
});

describe('spark_slack_post and direct messages', () => {
  const post = (args: Record<string, unknown>) => tools!.call('spark_slack_post', args);

  it('never posts in a one-to-one direct message, even an allowed one in Auto', async () => {
    await allow('D0SAM');
    await chatIn('Reply to Sam in Slack', 'auto');
    const result = await post({ threadUrl: SAM, text: 'On it' });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("can't post in a one-to-one direct message");
    expect(stub.slack.posted).toEqual([]);
  });

  it('always shows the card for an allowed group message, in Auto and in Full auto', async () => {
    await allow('G0CREW');
    await chatIn('Post an update to the Slack thread', 'bypassPermissions', true);
    const waiting = await post({ threadUrl: CREW, text: 'Shipped' });
    const card = await pendingCard(t);

    expect(waiting.json()).toMatchObject({ outcome: 'waiting_for_user' });
    expect(card.title).toBe('Post this to Slack? #alex, sam, spark (group message)');
    expect(stub.slack.posted).toEqual([]);

    const done = await confirmCard(t);
    expect(done.payload.sparkResult).toMatchObject({
      state: 'done',
      message: 'Posted to a thread in group message with alex, sam, spark.',
    });
    expect(stub.slack.posted).toEqual([
      { channel: 'G0CREW', text: 'Shipped', threadTs: '1760004000.000100', token: SLACK_BOT_TOKEN },
    ]);
  });

  it('refuses a group message that is not allowed', async () => {
    await chatIn('Post an update', 'auto');
    const result = await post({ channel: 'G0CREW', text: 'Shipped' });

    expect(result.isError).toBe(true);
    expect(stub.slack.posted).toEqual([]);
  });
});

describe('starting work from a direct message', () => {
  const start = (source: 'link' | 'shortcut', userId: string | null) => {
    const conversationId = crypto.randomUUID();
    return startFromSlack(
      { ...deps(), runTarget: async () => ({ provider: 'fake' }) },
      {
        source,
        ref: { channelId: 'D0SAM', ts: '1760001000.000100', threadTs: null },
        userId,
        conversationId,
        messageId: crypto.randomUUID(),
        mode: 'build',
        note: '',
      },
    );
  };

  beforeEach(async () => {
    await allow('D0SAM');
    await changeSlackSettings(deps(), { allowedUserIds: ['U0SAM'] });
  });

  it('lets only the connected member trigger it from Slack, and reads nothing for anyone else', async () => {
    await expect(start('shortcut', 'U0SAM')).rejects.toBeInstanceOf(SlackStartRefusedError);

    expect(stub.slack.calls).not.toContain('conversations.replies');
    const { rows } = await t.db.query("SELECT 1 FROM slack_events WHERE action = 'read'");
    expect(rows).toEqual([]);
  });

  it('never replies in the direct message, and notifies without the title or the text', async () => {
    const notifier = startSlackNotifier(deps(), { since: new Date(Date.now() - 60_000) });
    const started = await start('shortcut', SLACK_ME);
    await t.db.query("UPDATE runs SET status = 'succeeded', finished_at = now() WHERE id = $1", [
      started.runId,
    ]);
    notifier.changed({ kind: 'run', conversationId: started.conversationId, runId: started.runId });
    await notifier.settled();
    await notifier.stop();

    expect((await slackChatThread(t.db, started.conversationId))?.postUpdates).toBe(false);
    expect(stub.slack.posted).toHaveLength(1);
    const [message] = stub.slack.posted;
    expect(message).toMatchObject({ channel: SLACK_ME, token: SLACK_BOT_TOKEN });
    expect(message!.text).toContain(`*${DIRECT_CHAT_TITLE}*`);
    expect(message!.text).not.toMatch(/Sam|billing/);
  });
});

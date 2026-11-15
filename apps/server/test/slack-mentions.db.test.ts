import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listAttentionItems, markAttention } from '../src/persistence/attention-items.ts';
import { saveSlackMentions } from '../src/persistence/slack-mentions.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { changeSlackSettings, removeSlack, requireSlack } from '../src/slack/connection.ts';
import { findSlackMentions, startSlackMentionWatch } from '../src/slack/mentions.ts';
import { SLACK_ME } from './fake-slack.ts';
import { signInToSlack, slackDeps, startSlackStub, type SlackStub } from './slack-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let stub: SlackStub;
let secrets: SecretStore;
let seq = 0;

const deps = () => slackDeps(t, stub, secrets);

function freshTs(): string {
  seq += 1;
  return `${Math.floor(Date.now() / 1000) + seq}.${String(seq).padStart(6, '0')}`;
}

function say(channel: string, user: string, text: string, ts = freshTs()): string {
  (stub.slack.messages[channel] ??= []).push({ ts, user, text });
  return ts;
}

function watch() {
  return startSlackMentionWatch(deps(), { intervalMs: 3_600_000 });
}

async function mentionItems() {
  const items = await listAttentionItems(t.db, t.workspaceId);
  return items.filter((item) => item.kind === 'slack-mention');
}

beforeEach(async () => {
  t = await createTestDb();
  stub = await startSlackStub();
  secrets = memorySecretStore();
  seq = 0;
  await signInToSlack(deps(), stub);
});

afterEach(async () => {
  await stub.close();
  await t.cleanup();
});

describe('watching for @mentions of the user', () => {
  it('turns a new mention anywhere into one update with a link and no message text', async () => {
    say('C0RANDOM', 'U0SAM', `<@${SLACK_ME}> can you look at the deploy? xoxp-1234567890-leaked`);
    const watcher = watch();

    expect(await watcher.check()).toBe(1);
    expect(await watcher.check()).toBe(0);
    await watcher.stop();

    const items = await mentionItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      blocking: false,
      conversationId: null,
      detail: 'Sam Ortiz mentioned you in #random',
    });
    expect(items[0]!.url).toMatch(/^https:\/\/acme\.slack\.com\/archives\/C0RANDOM\//);
    const stored = await t.db.query('SELECT * FROM slack_mentions');
    expect(JSON.stringify(stored.rows)).not.toContain('deploy');
  });

  it('skips the user own messages, messages from before connecting and other people', async () => {
    say('C0ENG', SLACK_ME, `note to self <@${SLACK_ME}>`);
    say('C0ENG', 'U0SAM', `<@U0KIM> please review`);
    say('C0ENG', 'U0SAM', `<@${SLACK_ME}> old one`, '1700000000.000100');
    const watcher = watch();

    expect(await watcher.check()).toBe(0);
    await watcher.stop();
    expect(await mentionItems()).toEqual([]);
  });

  it('leaves direct messages out until the user allows them', async () => {
    say('D0SAM', 'U0SAM', `<@${SLACK_ME}> quick question`);
    const watcher = watch();

    expect(await watcher.check()).toBe(0);
    await watcher.stop();
    expect(await mentionItems()).toEqual([]);
  });

  it('stops when the switch is off', async () => {
    await changeSlackSettings(deps(), { watchMentions: false });
    say('C0WEB', 'U0KIM', `<@${SLACK_ME}> ping`);
    const watcher = watch();

    expect(await watcher.check()).toBe(0);
    await watcher.stop();
  });

  it('drops a dismissed mention from the list and keeps it gone', async () => {
    say('C0WEB', 'U0KIM', `<@${SLACK_ME}> ping`);
    const watcher = watch();
    await watcher.check();
    const [item] = await mentionItems();

    expect(await markAttention(t.db, t.workspaceId, item!.key, 'dismiss')).toBeNull();
    await watcher.check();
    await watcher.stop();
    expect(await mentionItems()).toEqual([]);
  });

  it('forgets mentions on Disconnect', async () => {
    say('C0WEB', 'U0KIM', `<@${SLACK_ME}> ping`);
    const watcher = watch();
    await watcher.check();
    await watcher.stop();

    await removeSlack(deps());

    const { rows } = await t.db.query('SELECT 1 FROM slack_mentions');
    expect(rows).toEqual([]);
    expect(await mentionItems()).toEqual([]);
  });

  it('never brings back mentions a check found before Disconnect or the switch went off', async () => {
    const { connection } = await requireSlack(deps());
    const owner = {
      teamId: connection.teamId,
      memberId: connection.memberId!,
      validatedAt: connection.validatedAt,
    };
    const late = {
      channelId: 'C0WEB',
      ts: freshTs(),
      authorName: 'Kim Lee',
      place: '#web-team',
      permalink: 'https://acme.slack.com/archives/C0WEB/p1',
      mentionedAt: new Date(),
    };

    await changeSlackSettings(deps(), { watchMentions: false });
    expect(await saveSlackMentions(t.db, t.workspaceId, owner, [late])).toBe(0);
    await changeSlackSettings(deps(), { watchMentions: true });
    await removeSlack(deps());
    expect(await saveSlackMentions(t.db, t.workspaceId, owner, [late])).toBe(0);
    await signInToSlack(deps(), stub);
    expect(await saveSlackMentions(t.db, t.workspaceId, owner, [late])).toBe(0);

    const { rows } = await t.db.query('SELECT 1 FROM slack_mentions');
    expect(rows).toEqual([]);
  });

  it('never holds up Quit while Slack asks it to wait', async () => {
    stub.slack.searchRetryAfter = 30;
    const watcher = watch();
    const checking = watcher.check();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(stub.slack.searchRetryAfter).toBeNull();

    const started = Date.now();
    await watcher.stop();

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(await checking).toBe(0);
  });

  it('finds the text of recent mentions for agents', async () => {
    say('C0WEB', 'U0KIM', `<@${SLACK_ME}> first`);
    say('C0OPS', 'U0SAM', `<@${SLACK_ME}> second`);

    const found = await findSlackMentions(deps(), await requireSlack(deps()));

    expect(found?.map((mention) => [mention.place, mention.authorName, mention.text])).toEqual(
      expect.arrayContaining([
        ['#web-team', 'Kim Lee', `<@${SLACK_ME}> first`],
        ['#ops', 'Sam Ortiz', `<@${SLACK_ME}> second`],
      ]),
    );
    expect(found?.some((mention) => mention.text.includes('Uploads over 2 GB'))).toBe(true);
  });
});

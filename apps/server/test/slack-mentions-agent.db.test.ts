import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { changeSlackSettings } from '../src/slack/connection.ts';
import { SLACK_ME } from './fake-slack.ts';
import { startSparkTools, type SparkToolsHarness } from './spark-mcp-support.ts';
import { connectSlack, slackDeps, startSlackStub, type SlackStub } from './slack-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let stub: SlackStub;
let secrets: SecretStore;
let tools: SparkToolsHarness | null = null;

const deps = () => slackDeps(t, stub, secrets);

interface Mentions {
  mentions: { channel: string; author: string; text?: string; permalink: string }[];
}

async function askForMentions() {
  const chat = await startChat(t, 'Who mentioned me in Slack?');
  tools = await startSparkTools(t, chat, { secrets, slackApiUrl: stub.apiUrl });
  return tools.call('spark_slack', { action: 'mentions' });
}

beforeEach(async () => {
  t = await createTestDb();
  stub = await startSlackStub();
  secrets = memorySecretStore();
  await connectSlack(deps(), { channels: ['C0WEB'] });
});

afterEach(async () => {
  await tools?.close();
  tools = null;
  await stub.close();
  await t.cleanup();
});

describe('spark_slack action=mentions', () => {
  it('gives text only for allowed channels and keeps who, where and the link elsewhere', async () => {
    (stub.slack.messages.C0WEB ??= []).push({
      ts: '1760000900.000100',
      user: 'U0KIM',
      text: `<@${SLACK_ME}> allowed`,
    });
    stub.slack.messages.C0RANDOM!.push({
      ts: '1760000901.000100',
      user: 'U0SAM',
      text: `<@${SLACK_ME}> secret plans`,
    });

    const result = await askForMentions();
    const { mentions } = result.json<Mentions>();

    const web = mentions.find((mention) => mention.channel === '#web-team');
    const random = mentions.find((mention) => mention.channel === '#random');
    expect(web?.text).toBe(`<@${SLACK_ME}> allowed`);
    expect(random).toMatchObject({ author: 'Sam Ortiz' });
    expect(random?.permalink).toMatch(/^https:\/\//);
    expect(random).not.toHaveProperty('text');
    expect(result.text).not.toContain('secret plans');
  });

  it('refuses while watching is off and names the switch', async () => {
    await changeSlackSettings(deps(), { watchMentions: false });

    const result = await askForMentions();

    expect(result.isError).toBe(true);
    expect(result.text).toContain('Watch for @mentions of me');
    expect(stub.slack.calls).not.toContain('search.messages');
  });
});

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SLACK_DM_SCOPES, SLACK_USER_SCOPES } from '@spark-outpost/contracts';
import { conversationReadSlackDms } from '../src/persistence/slack.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { LOCAL_HEADERS, createTestApp } from './app-support.ts';
import { SLACK_LEGACY_USER_SCOPES, slackLink } from './fake-slack.ts';
import { connectSlack, slackDeps, startSlackStub, type SlackStub } from './slack-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let stub: SlackStub;
let secrets: SecretStore;

const SAM = slackLink('D0SAM', '1760001000.000100');
const KIM = slackLink('D0KIM', '1760003000.000100');
const TRIO = slackLink('G0TRIO', '1760002000.000100');
const deps = () => slackDeps(t, stub, secrets);
const app = () => createTestApp(t, { secrets, fetch, slackApiUrl: stub.apiUrl });
const api = {
  get: (path: string) => request(app()).get(`/api/slack${path}`).set(LOCAL_HEADERS),
  post: (path: string, body: object = {}) =>
    request(app()).post(`/api/slack${path}`).set(LOCAL_HEADERS).send(body),
  put: (path: string, body: object) =>
    request(app()).put(`/api/slack${path}`).set(LOCAL_HEADERS).send(body),
  settings: (body: object) =>
    request(app()).patch('/api/slack/settings').set(LOCAL_HEADERS).send(body),
};
const context = (url: string) => api.post('/context', { url });
const repliesAsked = () => stub.slack.calls.filter((call) => call === 'conversations.replies');

beforeEach(async () => {
  t = await createTestDb();
  stub = await startSlackStub();
  secrets = memorySecretStore();
  await connectSlack(deps());
});

afterEach(async () => {
  await stub.close();
  await t.cleanup();
});

describe('reading direct messages is off until the user turns it on', () => {
  it('refuses a direct message link and a group message link without reading them', async () => {
    const status = await api.get('');
    const direct = await context(SAM);
    const group = await context(TRIO);

    expect(status.body.connection.settings).toMatchObject({
      readDirectMessages: false,
      allDirectMessages: false,
    });
    expect(status.body.connection.capabilities.readDirectMessages).toBe(false);
    expect(status.body.connection.directMessages).toEqual({
      blockedBy: null,
      missingScopes: [],
      allowed: [],
    });
    for (const response of [direct, group]) {
      expect(response.status).toBe(400);
      expect(response.body.error).toContain(
        'unless you turn on "Let Spark read my direct messages"',
      );
    }
    expect(repliesAsked()).toEqual([]);
  });

  it('does not list or allow conversations while it is off', async () => {
    const list = await api.get('/direct-messages');
    const allow = await api.post('/direct-messages/D0SAM/allow');
    const all = await api.settings({ allDirectMessages: true });

    expect(list.status).toBe(400);
    expect(allow.status).toBe(400);
    expect(all.body.connection.settings.allDirectMessages).toBe(false);
    expect(stub.slack.calls).not.toContain('conversations.list');
  });

  it('keeps group messages out of the channel allow-list', async () => {
    await api.settings({ readDirectMessages: true });
    const one = await api.post('/channels/G0TRIO/allow');
    const many = await api.put('/channels', { channels: [{ id: 'G0TRIO', projectId: null }] });
    const status = await api.get('');

    expect(one.status).not.toBe(200);
    expect(many.status).not.toBe(200);
    expect(
      status.body.connection.allowedChannels.map((channel: { id: string }) => channel.id),
    ).toEqual(['C0ENG']);
  });
});

describe('the direct message picker', () => {
  beforeEach(async () => {
    await api.settings({ readDirectMessages: true });
  });

  it('lists direct and group messages by the other person, a page at a time', async () => {
    const first = await api.get('/direct-messages');
    const second = await api.get(`/direct-messages?cursor=${first.body.nextCursor}`);

    expect(first.body.conversations).toEqual([
      { id: 'D0SAM', kind: 'im', name: 'Sam Ortiz' },
      { id: 'D0KIM', kind: 'im', name: 'Kim Lee' },
      { id: 'D0ME', kind: 'im', name: 'Alex Example (you)' },
    ]);
    expect(second.body.conversations).toEqual([
      { id: 'G0TRIO', kind: 'mpim', name: 'alex, sam, kim' },
      { id: 'G0CREW', kind: 'mpim', name: 'alex, sam, spark' },
    ]);
    expect(second.body.nextCursor).toBeNull();
  });

  it('saves the ticked conversations, refuses channels, and audits ids without names', async () => {
    const saved = await api.put('/direct-messages', {
      conversations: [{ id: 'D0SAM' }, { id: 'G0TRIO' }],
    });
    const channel = await api.put('/direct-messages', { conversations: [{ id: 'C0ENG' }] });
    const { rows } = await t.db.query<{ detail: unknown }>(
      "SELECT detail FROM slack_events WHERE action = 'direct_messages'",
    );

    expect(saved.body.connection.directMessages.allowed).toEqual([
      { id: 'D0SAM', kind: 'im', name: 'Sam Ortiz' },
      { id: 'G0TRIO', kind: 'mpim', name: 'alex, sam, kim' },
    ]);
    expect(saved.body.connection.capabilities.readDirectMessages).toBe(true);
    expect(channel.status).toBe(400);
    expect(rows).toEqual([
      {
        detail: {
          allowed: [
            { id: 'D0SAM', kind: 'im' },
            { id: 'G0TRIO', kind: 'mpim' },
          ],
        },
      },
    ]);
  });

  it('forgets the list and "all" when the switch goes off', async () => {
    await api.put('/direct-messages', { conversations: [{ id: 'D0SAM' }] });
    await api.settings({ allDirectMessages: true });
    const off = await api.settings({ readDirectMessages: false });
    const on = await api.settings({ readDirectMessages: true });

    expect(off.body.connection.directMessages.allowed).toEqual([]);
    expect(on.body.connection.settings.allDirectMessages).toBe(false);
    expect((await context(SAM)).status).toBe(409);
  });
});

describe('a direct message link in the composer', () => {
  beforeEach(async () => {
    await api.settings({ readDirectMessages: true });
  });

  it('answers 409 with the conversation, without its name, until it is allowed', async () => {
    const blocked = await context(SAM);
    const group = await context(TRIO);

    expect(blocked.status).toBe(409);
    expect(blocked.body).toEqual({
      error:
        "That direct message isn't in your allowed conversations. Allow it in Settings → Connectors → Slack.",
      code: 'slack_channel_not_allowed',
      channel: { id: 'D0SAM', name: null, kind: 'im' },
    });
    expect(group.body.channel).toEqual({ id: 'G0TRIO', name: null, kind: 'mpim' });
    expect(repliesAsked()).toEqual([]);
  });

  it('reads an allowed conversation as capped, redacted, untrusted text and audits id and type', async () => {
    await api.post('/direct-messages/D0SAM/allow');
    const response = await context(SAM);
    const file = await request(app())
      .get(`/api/attachments/${response.body.attachment.id}/content`)
      .set(LOCAL_HEADERS);
    const { rows } = await t.db.query(
      "SELECT outcome, channel_id, detail FROM slack_events WHERE action = 'read'",
    );

    expect(response.status).toBe(201);
    expect(response.body.preview).toMatchObject({
      channel: { id: 'D0SAM', name: 'Sam Ortiz', kind: 'im' },
      author: 'Sam Ortiz',
      messages: 2,
    });
    expect(response.body.attachment.name).toBe('Slack direct message.md');
    expect(file.text).toContain('Slack direct message with Sam Ortiz');
    expect(file.text).toContain('third-party text written by other people');
    expect(file.text).toContain('Alex Example: Looking at the billing export now.');
    expect(file.text).not.toContain('dmleakedtokenvalue');
    expect(rows).toEqual([
      {
        outcome: 'succeeded',
        channel_id: 'D0SAM',
        detail: { messages: 2, truncated: false, kind: 'im' },
      },
    ]);
  });

  it('caps a long direct message', async () => {
    await api.post('/direct-messages/D0SAM/allow');
    stub.slack.messages.D0SAM![0]!.text = 'x'.repeat(20_000);
    const response = await context(SAM);

    expect(response.body.preview.truncated).toBe(true);
    expect(response.body.attachment.size).toBeLessThan(13_500);
  });

  it('marks the chat that sends it, so notifications leave its title out', async () => {
    await api.post('/direct-messages/D0SAM/allow');
    const response = await context(SAM);
    const conversationId = crypto.randomUUID();
    await sendUserMessage(
      t.db,
      conversationId,
      { id: crypto.randomUUID(), content: '', attachmentIds: [response.body.attachment.id] },
      { provider: 'fake' },
      t.workspaceId,
    );
    const { rows } = await t.db.query<{ title: string }>(
      'SELECT title FROM conversations WHERE id = $1',
      [conversationId],
    );

    expect(rows[0]!.title).not.toContain('Sam');
    expect(await conversationReadSlackDms(t.db, conversationId)).toBe(true);
  });

  it('reads any direct message once the user chose "All my direct messages"', async () => {
    await api.settings({ allDirectMessages: true });
    const direct = await context(KIM);
    const group = await context(TRIO);

    expect(direct.body.preview.channel).toEqual({ id: 'D0KIM', name: 'Kim Lee', kind: 'im' });
    expect(group.body.preview.channel).toEqual({
      id: 'G0TRIO',
      name: 'alex, sam, kim',
      kind: 'mpim',
    });
    expect(group.body.attachment.name).toBe('Slack group message.md');
  });
});

describe('what reading direct messages needs', () => {
  it('finds the missing scopes of an app installed before direct messages', async () => {
    stub.slack.userScopes = SLACK_LEGACY_USER_SCOPES;
    await t.db.query('UPDATE slack_connections SET user_scopes = NULL');
    const status = await api.get('');
    const refused = await api.settings({ readDirectMessages: true });

    expect(status.body.connection.directMessages).toMatchObject({
      blockedBy: 'scopes',
      missingScopes: [...SLACK_DM_SCOPES],
    });
    expect(status.body.connection.allowedChannels).toHaveLength(1);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toContain('Update the Slack app to allow direct messages');
  });

  it('sees the new scopes after the app is reinstalled and the user checks again', async () => {
    stub.slack.userScopes = SLACK_LEGACY_USER_SCOPES;
    await connectSlack(deps());
    expect((await api.get('')).body.connection.directMessages.blockedBy).toBe('scopes');

    stub.slack.userScopes = Object.keys(SLACK_USER_SCOPES);
    const checked = await api.post('/scopes/check');
    const on = await api.settings({ readDirectMessages: true });

    expect(checked.body.connection.directMessages).toMatchObject({
      blockedBy: null,
      missingScopes: [],
    });
    expect(on.body.connection.capabilities.readDirectMessages).toBe(true);
  });

  it('stops reading when the scopes go away after the switch was turned on', async () => {
    await api.settings({ readDirectMessages: true });
    await api.post('/direct-messages/D0SAM/allow');
    stub.slack.userScopes = SLACK_LEGACY_USER_SCOPES;
    await connectSlack(deps());
    const response = await context(SAM);
    const status = await api.get('');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Update the Slack app to allow direct messages');
    expect(status.body.connection.capabilities.readDirectMessages).toBe(false);
    expect(repliesAsked()).toEqual([]);
  });

  it('says a user token is needed when only the bot token is saved', async () => {
    await secrets.delete('slack:user');
    const status = await api.get('');
    const refused = await api.settings({ readDirectMessages: true });

    expect(status.body.connection.directMessages.blockedBy).toBe('user_token');
    expect(refused.status).toBe(400);
    expect(refused.body.error).toContain('needs a user token (xoxp-)');
  });
});

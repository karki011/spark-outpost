import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertApproval } from '../src/persistence/approvals.ts';
import { markAttention } from '../src/persistence/attention-items.ts';
import { pushKeys } from '../src/remote/push-keys.ts';
import { startPushNotifier, type PushNotifier } from '../src/remote/push-notifier.ts';
import type { PushDelivery } from '../src/remote/push-send.ts';
import { saveRemoteHostname, saveRemoteSwitches } from '../src/remote/store.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

const HOST = 'mac.tail1234.ts.net';
const KEYS = { publicKey: 'BPublicKeyForTests', privateKey: 'private-key-for-tests' };
const PIXEL = 'https://fcm.googleapis.com/fcm/send/pixel';
const IPAD = 'https://fcm.googleapis.com/fcm/send/ipad';

let t: TestDb;
let notifier: PushNotifier;
let sent: PushDelivery[];
let focused: string[];
let chat: { conversationId: string; runId: string };
let phone: string;
let holding: boolean;
let since: Date;

async function addDevice(name: string, endpoint: string): Promise<string> {
  const id = randomUUID();
  await t.db.query(
    `INSERT INTO remote_devices (id, workspace_id, name, token_hash) VALUES ($1, $2, $3, $4)`,
    [id, t.workspaceId, name, randomUUID().replaceAll('-', '').padEnd(64, '0')],
  );
  await t.db.query(
    `INSERT INTO remote_push_subscriptions
       (id, workspace_id, device_id, endpoint, p256dh, auth, hostname, server_key)
     VALUES ($1, $2, $3, $4, 'p256dh', 'auth', $5, $6)`,
    [randomUUID(), t.workspaceId, id, endpoint, HOST, KEYS.publicKey],
  );
  return id;
}

function startNotifier() {
  const secrets = memorySecretStore({ 'remote:push': JSON.stringify(KEYS) });
  notifier = startPushNotifier(
    {
      db: t.db,
      workspaceId: t.workspaceId,
      keys: pushKeys(secrets, () => {
        throw new Error('The test keys are already saved.');
      }),
      focus: { focusedClients: () => focused },
      send: async (delivery) => {
        sent.push(delivery);
        return { outcome: 'sent', status: null, reason: null };
      },
      held: () => holding,
    },
    { since, batchMs: 60_000 },
  );
}

beforeEach(async () => {
  t = await createTestDb();
  sent = [];
  focused = [];
  holding = false;
  since = new Date(Date.now() - 60_000);
  startNotifier();
  await saveRemoteHostname(t.db, t.workspaceId, HOST);
  await saveRemoteSwitches(t.db, t.workspaceId, { notifications: true, notifyUpdates: true });
  chat = await startChat(t, 'Fix the upload retry');
  phone = await addDevice('Pixel', PIXEL);
});

afterEach(async () => {
  await notifier.stop();
  await t.cleanup();
});

async function finish(status: 'succeeded' | 'failed', runId = chat.runId) {
  await t.db.query(
    `UPDATE runs SET status = $2, started_at = now(), finished_at = now(),
       error = CASE WHEN $2 = 'failed' THEN 'Secret failure at /Users/me/private' END
     WHERE id = $1`,
    [runId, status],
  );
}

async function changed(conversationId = chat.conversationId) {
  notifier.changed({ kind: 'run', conversationId, runId: chat.runId });
  await notifier.settled();
}

const payloads = () =>
  sent.map((delivery) => JSON.parse(delivery.payload) as Record<string, unknown>);

const wait = () => new Promise((resolve) => setTimeout(resolve, 150));

async function ask(command = 'rm -rf build') {
  return insertApproval(t.db, {
    runId: chat.runId,
    toolCallId: `tool-${randomUUID()}`,
    rpcId: null,
    kind: 'execute',
    title: command,
    payload: { command, cwd: '/Users/me/secret-project', paths: [], diffs: [], truncated: false },
    options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
    reason: null,
  });
}

describe('a finished or failed turn', () => {
  it('sends a fixed line for a finished turn and for a failed one, never the error', async () => {
    await finish('succeeded');
    await changed();
    expect(payloads()).toEqual([
      {
        title: 'Fix the upload retry',
        body: 'Finished',
        chatId: chat.conversationId,
        tag: `spark-chat-${chat.conversationId}`,
        keys: [`run-done:${chat.runId}`],
      },
    ]);

    const second = await startChat(t, 'Break the build');
    await finish('failed', second.runId);
    await changed(second.conversationId);
    expect(payloads()[1]).toMatchObject({ title: 'Break the build', body: 'Failed' });
    expect(sent.map((delivery) => delivery.payload).join()).not.toContain('Secret failure');
  });

  it('sends once per run however often the chat changes', async () => {
    await finish('succeeded');
    await changed();
    await changed();
    await changed();
    expect(sent).toHaveLength(1);
  });

  it('sends nothing while the switch is off, and a turn that ended meanwhile never goes out later', async () => {
    await saveRemoteSwitches(t.db, t.workspaceId, { notifyUpdates: false });
    await finish('succeeded');
    await changed();
    await saveRemoteSwitches(t.db, t.workspaceId, { notifyUpdates: true });
    await changed();
    expect(sent).toEqual([]);
  });

  it('sends nothing while notifications are off, even with this switch on', async () => {
    await saveRemoteSwitches(t.db, t.workspaceId, { notifications: false });
    await finish('succeeded');
    await changed();
    expect(sent).toEqual([]);
  });

  it('sends nothing for a turn that ended before the notifier started', async () => {
    await finish('succeeded');
    await notifier.stop();
    since = new Date(Date.now() + 60_000);
    startNotifier();
    await changed();
    expect(sent).toEqual([]);
  });
});

describe('a turn the user already handled', () => {
  it('sends nothing when the chat was seen after the turn ended', async () => {
    await finish('succeeded');
    notifier.changed({ kind: 'run', conversationId: chat.conversationId, runId: chat.runId });
    await wait();
    await t.db.query(
      `UPDATE conversations SET seen_at = now() + interval '1 second' WHERE id = $1`,
      [chat.conversationId],
    );
    await notifier.settled();
    expect(sent).toEqual([]);
  });

  it('sends nothing for an item read, set aside or dismissed during the wait', async () => {
    for (const mark of ['read', 'set-aside', 'dismiss'] as const) {
      const one = await startChat(t, `Chat ${mark}`);
      await finish('succeeded', one.runId);
      notifier.changed({ kind: 'run', conversationId: one.conversationId, runId: one.runId });
      await wait();
      await markAttention(t.db, t.workspaceId, `run-done:${one.runId}`, mark);
      await notifier.settled();
    }
    expect(sent).toEqual([]);
  });

  it('sends nothing for an item already read when the turn is scanned', async () => {
    await finish('succeeded');
    await markAttention(t.db, t.workspaceId, `run-done:${chat.runId}`, 'read');
    await changed();
    expect(sent).toEqual([]);
  });

  it('closes the notification once the update is read', async () => {
    await finish('succeeded');
    await changed();
    expect(sent).toHaveLength(1);
    await markAttention(t.db, t.workspaceId, `run-done:${chat.runId}`, 'read');
    notifier.changed({ kind: 'attention', conversationId: chat.conversationId, runId: null });
    await notifier.settled();
    expect(payloads()[1]).toEqual({
      close: `spark-chat-${chat.conversationId}`,
      keys: [`run-done:${chat.runId}`],
    });
  });
});

describe('who gets it and when', () => {
  it('skips a focused device and still notifies the others', async () => {
    await addDevice('iPad', IPAD);
    focused = [`device:${phone}`];
    await finish('succeeded');
    await changed();
    expect(sent.map((delivery) => delivery.endpoint)).toEqual([IPAD]);
  });

  it('holds during a calendar hold and sends once it ends', async () => {
    holding = true;
    await finish('succeeded');
    await changed();
    expect(sent).toEqual([]);
    holding = false;
    notifier.release();
    await notifier.settled();
    expect(payloads()).toEqual([expect.objectContaining({ body: 'Finished' })]);
  });

  it('drops a held update the user read during the hold', async () => {
    holding = true;
    await finish('succeeded');
    await changed();
    await markAttention(t.db, t.workspaceId, `run-done:${chat.runId}`, 'read');
    holding = false;
    notifier.release();
    await notifier.settled();
    expect(sent).toEqual([]);
  });
});

describe('chats that never push an update', () => {
  it('skips the Ask Spark chat', async () => {
    await t.db.query(
      `INSERT INTO profiles (workspace_id, assistant_conversation_id) VALUES ($1, $2)
       ON CONFLICT (workspace_id) DO UPDATE SET assistant_conversation_id = $2`,
      [t.workspaceId, chat.conversationId],
    );
    await finish('succeeded');
    await changed();
    expect(sent).toEqual([]);
  });

  it('skips a child run of a turn that is still going', async () => {
    const child = randomUUID();
    await t.db.query(
      `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, parent_run_id,
         role, started_at, finished_at)
       SELECT $1, conversation_id, user_message_id, provider, 'succeeded', id, 'builder',
         now(), now()
       FROM runs WHERE id = $2`,
      [child, chat.runId],
    );
    await changed();
    expect(sent).toEqual([]);
  });
});

describe('the needs-you push', () => {
  it('is unchanged with the switch off and carries the card id for exactly one card', async () => {
    await saveRemoteSwitches(t.db, t.workspaceId, { notifyUpdates: false });
    const card = await ask();
    await changed();
    expect(payloads()).toEqual([
      expect.objectContaining({ body: 'Needs your approval', cardId: card.id }),
    ]);
  });

  it('leaves the card id out when two cards wait together', async () => {
    await ask();
    await ask('ls');
    await changed();
    expect(sent).toHaveLength(1);
    expect(payloads()[0]).not.toHaveProperty('cardId');
    expect(payloads()[0]).toMatchObject({ body: 'Needs your approval (2)' });
  });
});

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertApproval } from '../src/persistence/approvals.ts';
import { markAttention } from '../src/persistence/attention-items.ts';
import { pushKeys } from '../src/remote/push-keys.ts';
import { startPushNotifier, type PushNotifier } from '../src/remote/push-notifier.ts';
import { PUSH_CONTACT_DEFAULT } from '@spark-outpost/contracts';
import type { PushDelivery, PushResult } from '../src/remote/push-send.ts';
import { savePushContact } from '../src/remote/push-store.ts';
import { revokeDevice, saveRemoteHostname, saveRemoteSwitches } from '../src/remote/store.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

const HOST = 'mac.tail1234.ts.net';
const SINCE = new Date(Date.now() - 60_000);
const KEYS = { publicKey: 'BPublicKeyForTests', privateKey: 'private-key-for-tests' };

let t: TestDb;
let notifier: PushNotifier;
let sent: PushDelivery[];
let result: PushResult;
let focused: string[];
let chat: { conversationId: string; runId: string };
let phone: string;
let holding: boolean;

async function addDevice(name: string): Promise<string> {
  const id = randomUUID();
  await t.db.query(
    `INSERT INTO remote_devices (id, workspace_id, name, token_hash) VALUES ($1, $2, $3, $4)`,
    [id, t.workspaceId, name, randomUUID().replaceAll('-', '').padEnd(64, '0')],
  );
  return id;
}

async function subscribe(deviceId: string, endpoint: string, hostname = HOST) {
  await t.db.query(
    `INSERT INTO remote_push_subscriptions
       (id, workspace_id, device_id, endpoint, p256dh, auth, hostname, server_key)
     VALUES ($1, $2, $3, $4, 'p256dh', 'auth', $5, $6)`,
    [randomUUID(), t.workspaceId, deviceId, endpoint, hostname, KEYS.publicKey],
  );
}

beforeEach(async () => {
  t = await createTestDb();
  sent = [];
  result = { outcome: 'sent', status: null, reason: null };
  focused = [];
  holding = false;
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
        return result;
      },
      held: () => holding,
    },
    { since: SINCE, batchMs: 60_000 },
  );
  await saveRemoteHostname(t.db, t.workspaceId, HOST);
  await saveRemoteSwitches(t.db, t.workspaceId, { notifications: true });
  chat = await startChat(t, 'Fix the upload retry');
  phone = await addDevice('Pixel');
  await subscribe(phone, 'https://fcm.googleapis.com/fcm/send/pixel');
});

afterEach(async () => {
  await notifier.stop();
  await t.cleanup();
});

function ask(kind: 'execute' | 'plan' | 'clarify', command = 'rm -rf build') {
  return insertApproval(t.db, {
    runId: chat.runId,
    toolCallId: `tool-${randomUUID()}`,
    rpcId: null,
    kind,
    title: command,
    payload: { command, cwd: '/Users/me/secret-project', paths: [], diffs: [], truncated: false },
    options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
    reason: null,
  });
}

async function changed(kind: 'approval' | 'conversation' = 'approval') {
  notifier.changed({ kind, conversationId: chat.conversationId, runId: chat.runId });
  await notifier.settled();
}

const scanned = () => new Promise((resolve) => setTimeout(resolve, 150));

const payloads = () => sent.map((delivery) => JSON.parse(delivery.payload) as object);

async function markSeen() {
  await t.db.query('UPDATE conversations SET seen_at = now() WHERE id = $1', [chat.conversationId]);
}

describe('a chat the user has looked at', () => {
  it('sends nothing for a card the user saw on the Mac or a device during the wait', async () => {
    await ask('execute');
    notifier.changed({ kind: 'approval', conversationId: chat.conversationId, runId: chat.runId });
    await scanned();
    await markSeen();
    await notifier.settled();
    expect(sent).toEqual([]);
    await changed();
    expect(sent).toEqual([]);
  });

  it('sends nothing for a card read, set aside or dismissed anywhere during the wait', async () => {
    for (const mark of ['read', 'set-aside', 'dismiss'] as const) {
      const card = await ask('execute');
      notifier.changed({
        kind: 'approval',
        conversationId: chat.conversationId,
        runId: chat.runId,
      });
      await scanned();
      await markAttention(t.db, t.workspaceId, `approval:${card.id}`, mark);
      await notifier.settled();
      expect([mark, sent]).toEqual([mark, []]);
    }
  });

  it('sends a close for a notification once its card is read or answered elsewhere', async () => {
    const card = await ask('execute');
    await changed();
    await notifier.settled();
    expect(payloads()).toHaveLength(1);
    expect(payloads()[0]).toMatchObject({ keys: [`approval:${card.id}`] });
    await markAttention(t.db, t.workspaceId, `approval:${card.id}`, 'read');
    notifier.changed({ kind: 'attention', conversationId: chat.conversationId, runId: null });
    await notifier.settled();
    expect(payloads()[1]).toEqual({
      close: `spark-chat-${chat.conversationId}`,
      keys: [`approval:${card.id}`],
    });
    notifier.changed({ kind: 'attention', conversationId: chat.conversationId, runId: null });
    await notifier.settled();
    expect(payloads()).toHaveLength(2);
  });

  it('still sends for a card that arrives after the user last looked', async () => {
    await markSeen();
    await ask('execute');
    await changed();
    expect(payloads()).toHaveLength(1);
  });
});

describe('a card waiting', () => {
  it('sends the chat title and what is waiting, and never the command', async () => {
    await ask('execute', 'curl https://example.test/upload?token=abc');
    await changed();
    expect(payloads()).toEqual([
      {
        title: 'Fix the upload retry',
        body: 'Needs your approval',
        chatId: chat.conversationId,
        tag: `spark-chat-${chat.conversationId}`,
        keys: [expect.stringMatching(/^approval:/)],
      },
    ]);
    expect(sent[0]).toMatchObject({
      endpoint: 'https://fcm.googleapis.com/fcm/send/pixel',
      keys: KEYS,
    });
    expect(sent[0]!.payload).not.toContain('curl');
    expect(sent[0]!.payload).not.toContain('secret-project');
  });

  it('sends once however many times the chat changes', async () => {
    await ask('clarify');
    await changed();
    await changed('conversation');
    await changed();
    expect(payloads()).toHaveLength(1);
    expect(payloads()[0]).toMatchObject({ body: 'Has a question for you' });
  });

  it('puts cards waiting together into one notification', async () => {
    await ask('execute');
    await ask('execute', 'npm publish');
    await ask('plan');
    await changed();
    expect(payloads()).toEqual([
      expect.objectContaining({
        body: 'Needs your approval (2) · Has a plan for you to review',
      }),
    ]);
  });

  it('sends nothing for a card answered before the notification went out', async () => {
    const approval = await ask('execute');
    notifier.changed({ kind: 'approval', conversationId: chat.conversationId, runId: null });
    await scanned();
    await t.db.query(
      "UPDATE approvals SET status = 'cancelled', decided_by = 'stop', decided_at = now() WHERE id = $1",
      [approval.id],
    );
    await notifier.settled();
    expect(sent).toEqual([]);

    await t.db.query(
      "UPDATE approvals SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = $1",
      [approval.id],
    );
    await changed();
    expect(sent).toEqual([]);
  });

  it('sends nothing for a card that was waiting before Spark started', async () => {
    const approval = await ask('execute');
    await t.db.query(`UPDATE approvals SET created_at = now() - interval '1 hour' WHERE id = $1`, [
      approval.id,
    ]);
    await changed();
    expect(sent).toEqual([]);
  });
});

describe('who gets it', () => {
  beforeEach(async () => {
    await ask('execute');
  });

  it('skips a device that is open and in focus, and still notifies the others', async () => {
    const tablet = await addDevice('Tablet');
    await subscribe(tablet, 'https://web.push.apple.com/tablet');
    focused = [`device:${phone}`, 'local:window'];
    await changed();
    expect(sent.map((delivery) => delivery.endpoint)).toEqual([
      'https://web.push.apple.com/tablet',
    ]);
  });

  it('closes the notification on a device that came into focus after it was sent, and only where it was sent', async () => {
    const tablet = await addDevice('Tablet');
    await subscribe(tablet, 'https://web.push.apple.com/tablet');
    focused = [`device:${tablet}`];
    await changed();
    await notifier.settled();
    expect(sent).toHaveLength(1);
    focused = [`device:${phone}`];
    const { rows } = await t.db.query<{ id: string }>(
      `SELECT id FROM approvals WHERE status = 'pending' LIMIT 1`,
    );
    await markAttention(t.db, t.workspaceId, `approval:${rows[0]!.id}`, 'read');
    notifier.changed({ kind: 'attention', conversationId: chat.conversationId, runId: null });
    await notifier.settled();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.endpoint).toBe(sent[0]!.endpoint);
    expect(JSON.parse(sent[1]!.payload)).toMatchObject({
      close: `spark-chat-${chat.conversationId}`,
    });
  });

  it('skips a revoked device and one not seen for 30 days', async () => {
    const stale = await addDevice('Old phone');
    await subscribe(stale, 'https://web.push.apple.com/old');
    await t.db.query(
      `UPDATE remote_devices SET last_seen_at = now() - interval '31 days' WHERE id = $1`,
      [stale],
    );
    await revokeDevice(t.db, t.workspaceId, phone);
    await changed();
    expect(sent).toEqual([]);
  });

  it('sends nothing while the switch is off', async () => {
    await saveRemoteSwitches(t.db, t.workspaceId, { notifications: false });
    await changed();
    expect(sent).toEqual([]);
  });

  it('sends nothing while remote control is off', async () => {
    await saveRemoteHostname(t.db, t.workspaceId, null);
    await changed();
    expect(sent).toEqual([]);
  });

  it('skips a subscription made under an older address or key', async () => {
    await t.db.query('DELETE FROM remote_push_subscriptions');
    await subscribe(phone, 'https://fcm.googleapis.com/fcm/send/old-host', 'old.tail1234.ts.net');
    await t.db.query(
      `INSERT INTO remote_push_subscriptions
         (id, workspace_id, device_id, endpoint, p256dh, auth, hostname, server_key)
       VALUES ($1, $2, $3, 'https://fcm.googleapis.com/fcm/send/old-key', 'p', 'a', $4, 'old')`,
      [randomUUID(), t.workspaceId, phone, HOST],
    );
    await changed();
    expect(sent).toEqual([]);
  });

  it('forgets a subscription the push service says is gone', async () => {
    result = { outcome: 'gone', status: 410, reason: null };
    await changed();
    expect(sent).toHaveLength(1);
    const { rows } = await t.db.query('SELECT 1 FROM remote_push_subscriptions');
    expect(rows).toEqual([]);
  });

  it('records each send in the remote activity without the content', async () => {
    result = { outcome: 'failed', status: 500, reason: null };
    await changed();
    const { rows } = await t.db.query<{ device_id: string; detail: object }>(
      "SELECT device_id, detail FROM remote_audit WHERE action = 'notification_sent'",
    );
    expect(rows).toEqual([{ device_id: phone, detail: { outcome: 'failed' } }]);
  });

  it('records why the push service refused a notification', async () => {
    result = { outcome: 'failed', status: 403, reason: 'BadJwtToken' };
    await changed();
    const { rows } = await t.db.query<{ status: number; detail: object }>(
      "SELECT status, detail FROM remote_audit WHERE action = 'notification_sent'",
    );
    expect(rows).toEqual([{ status: 403, detail: { outcome: 'failed', reason: 'BadJwtToken' } }]);
  });

  it('signs with the project page until a contact is set, then with that contact', async () => {
    await changed();
    await savePushContact(t.db, t.workspaceId, 'mailto:me@example.org');
    await ask('plan');
    await changed();
    expect(sent.map((delivery) => delivery.subject)).toEqual([
      PUSH_CONTACT_DEFAULT,
      'mailto:me@example.org',
    ]);
  });

  it('never signs with a saved contact that names the tailnet', async () => {
    await savePushContact(t.db, t.workspaceId, `https://${HOST}`);
    await changed();
    expect(sent.map((delivery) => delivery.subject)).toEqual([PUSH_CONTACT_DEFAULT]);
  });
});

describe('a Terminal session waiting', () => {
  let sessionId: string;

  beforeEach(async () => {
    sessionId = randomUUID();
    await t.db.query(
      `INSERT INTO native_terminal_sessions (id, conversation_id, provider, state, cwd, label)
       VALUES ($1, $2, 'claude', 'working', '/Users/me/secret-project', 'Claude Code')`,
      [sessionId, chat.conversationId],
    );
  });

  const setState = (state: string) =>
    t.db.query(
      `UPDATE native_terminal_sessions SET state = $2, updated_at = now(),
         waiting_since = CASE
           WHEN $2 NOT IN ('waiting_for_permission', 'waiting_for_input') THEN NULL
           WHEN state = $2 THEN COALESCE(waiting_since, now())
           ELSE now() END
       WHERE id = $1`,
      [sessionId, state],
    );

  it('sends once each time the session starts waiting', async () => {
    await changed('conversation');
    expect(sent).toEqual([]);

    await setState('waiting_for_permission');
    await changed('conversation');
    await setState('waiting_for_permission');
    await changed('conversation');
    expect(payloads()).toEqual([
      expect.objectContaining({ body: 'Waiting for permission in the terminal' }),
    ]);

    await setState('working');
    await changed('conversation');
    await setState('waiting_for_input');
    await changed('conversation');
    expect(payloads().map((payload) => (payload as { body?: string }).body ?? 'close')).toEqual([
      'Waiting for permission in the terminal',
      'close',
      'Waiting for input in the terminal',
    ]);
    expect(sent.some((delivery) => delivery.payload.includes('secret-project'))).toBe(false);
  });

  it('sends nothing when the session moved on before the notification went out', async () => {
    await setState('waiting_for_input');
    notifier.changed({ kind: 'conversation', conversationId: chat.conversationId, runId: null });
    await scanned();
    await setState('working');
    await notifier.settled();
    expect(sent).toEqual([]);
  });
});

describe('calendar', () => {
  it('sends a meeting alert with no title, chat, prep or link', async () => {
    notifier.meeting(10);
    await notifier.settled();
    expect(payloads()).toEqual([
      { title: 'Meeting in 10 min', body: '', chatId: null, tag: 'spark-meeting' },
    ]);
  });

  it('sends no meeting alert while the notify switch is off or alerts are held', async () => {
    holding = true;
    notifier.meeting(10);
    await notifier.settled();
    await saveRemoteSwitches(t.db, t.workspaceId, { notifications: false });
    holding = false;
    notifier.meeting(5);
    await notifier.settled();
    expect(sent).toEqual([]);
  });

  it('holds chat pushes during focus and sends them once the hold ends', async () => {
    holding = true;
    await ask('execute');
    await changed();
    expect(sent).toEqual([]);
    holding = false;
    notifier.release();
    await notifier.settled();
    expect(payloads()).toEqual([expect.objectContaining({ body: 'Needs your approval' })]);
  });

  it('drops a held push whose card was answered during the hold', async () => {
    holding = true;
    const approval = await ask('execute');
    await changed();
    await t.db.query(
      "UPDATE approvals SET status = 'cancelled', decided_by = 'stop', decided_at = now() WHERE id = $1",
      [approval.id],
    );
    holding = false;
    notifier.release();
    await notifier.settled();
    expect(sent).toEqual([]);
  });
});

describe('a test notification', () => {
  it('goes to the chosen device with fixed text, even while it is focused or alerts are held', async () => {
    const other = await addDevice('iPad');
    await subscribe(other, 'https://fcm.googleapis.com/fcm/send/ipad');
    focused = [`device:${phone}`];
    holding = true;
    expect(await notifier.test(phone)).toEqual({ outcome: 'sent', reason: null });
    expect(sent.map((delivery) => delivery.endpoint)).toEqual([
      'https://fcm.googleapis.com/fcm/send/pixel',
    ]);
    expect(payloads()).toEqual([
      {
        title: 'Spark Outpost',
        body: 'Test notification. This device gets alerts from your Mac.',
        chatId: null,
        tag: 'spark-test',
      },
    ]);
  });

  it('sends nothing while the switch is off or the device has no subscription', async () => {
    const bare = await addDevice('Laptop');
    expect(await notifier.test(bare)).toEqual({ outcome: 'none', reason: null });
    await saveRemoteSwitches(t.db, t.workspaceId, { notifications: false });
    expect(await notifier.test(phone)).toEqual({ outcome: 'off', reason: null });
    expect(sent).toEqual([]);
  });

  it('reports a refusal with its reason and an ended registration', async () => {
    result = { outcome: 'failed', status: 403, reason: 'BadJwtToken' };
    expect(await notifier.test(phone)).toEqual({ outcome: 'failed', reason: 'BadJwtToken' });
    result = { outcome: 'gone', status: 410, reason: null };
    expect(await notifier.test(phone)).toEqual({ outcome: 'gone', reason: null });
    expect(await notifier.test(phone)).toEqual({ outcome: 'none', reason: null });
  });
});

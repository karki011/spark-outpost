import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertApproval } from '../src/persistence/approvals.ts';
import { markAttention } from '../src/persistence/attention-items.ts';
import { createMacPresence, type MacPresence } from '../src/remote/mac-presence.ts';
import { pushKeys } from '../src/remote/push-keys.ts';
import { startPushNotifier, type PushNotifier } from '../src/remote/push-notifier.ts';
import type { PushDelivery } from '../src/remote/push-send.ts';
import { remoteAccess, saveRemoteHostname, saveRemoteSwitches } from '../src/remote/store.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

const HOST = 'mac.tail1234.ts.net';
const MINUTE = 60_000;
const KEYS = { publicKey: 'BPublicKeyForTests', privateKey: 'private-key-for-tests' };

let t: TestDb;
let notifier: PushNotifier;
let presence: MacPresence;
let fromMac: ((message: unknown) => void) | null;
let toMac: unknown[];
let sent: PushDelivery[];
let chat: { conversationId: string; runId: string };
let clock: number;

async function addDevice(): Promise<void> {
  const id = randomUUID();
  await t.db.query(
    `INSERT INTO remote_devices (id, workspace_id, name, token_hash) VALUES ($1, $2, 'Pixel', $3)`,
    [id, t.workspaceId, randomUUID().replaceAll('-', '').padEnd(64, '0')],
  );
  await t.db.query(
    `INSERT INTO remote_push_subscriptions
       (id, workspace_id, device_id, endpoint, p256dh, auth, hostname, server_key)
     VALUES ($1, $2, $3, 'https://fcm.googleapis.com/fcm/send/pixel', 'p256dh', 'auth', $4, $5)`,
    [randomUUID(), t.workspaceId, id, HOST, KEYS.publicKey],
  );
}

function startNotifier(since: Date) {
  fromMac = null;
  toMac = [];
  presence = createMacPresence({
    post: (message) => toMac.push(message),
    subscribe: (listener) => {
      fromMac = listener;
    },
  });
  notifier = startPushNotifier(
    {
      db: t.db,
      workspaceId: t.workspaceId,
      keys: pushKeys(memorySecretStore({ 'remote:push': JSON.stringify(KEYS) }), () => {
        throw new Error('The test keys are already saved.');
      }),
      focus: { focusedClients: () => [] },
      send: async (delivery) => {
        sent.push(delivery);
        return { outcome: 'sent', status: null, reason: null };
      },
      present: () => presence.present(),
    },
    { since, batchMs: 60_000, now: () => clock },
  );
  presence.onAway(() => notifier.release());
}

async function atMac(present: boolean) {
  fromMac?.({ kind: 'presence:state', present });
  await notifier.settled();
}

beforeEach(async () => {
  t = await createTestDb();
  sent = [];
  clock = Date.now();
  startNotifier(new Date(Date.now() - 60_000));
  await saveRemoteHostname(t.db, t.workspaceId, HOST);
  await saveRemoteSwitches(t.db, t.workspaceId, { notifications: true, notifyUpdates: true });
  chat = await startChat(t, 'Fix the upload retry');
  await addDevice();
});

afterEach(async () => {
  await notifier.stop();
  await t.cleanup();
});

async function ask() {
  const approval = await insertApproval(t.db, {
    runId: chat.runId,
    toolCallId: `tool-${randomUUID()}`,
    rpcId: null,
    kind: 'execute',
    title: 'rm -rf build',
    payload: { command: 'rm -rf build', cwd: '/w', paths: [], diffs: [], truncated: false },
    options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
    reason: null,
  });
  notifier.changed({ kind: 'approval', conversationId: chat.conversationId, runId: chat.runId });
  await notifier.settled();
  return approval;
}

async function finish() {
  await t.db.query(
    `UPDATE runs SET status = 'succeeded', started_at = now(), finished_at = now() WHERE id = $1`,
    [chat.runId],
  );
  notifier.changed({ kind: 'run', conversationId: chat.conversationId, runId: chat.runId });
  await notifier.settled();
}

const bodies = () =>
  sent.map((delivery) => (JSON.parse(delivery.payload) as { body: string; title: string }).body);
const titles = () =>
  sent.map((delivery) => (JSON.parse(delivery.payload) as { title: string }).title);

describe('only notify when away from the Mac', () => {
  it('is on for a new install and asks the Mac whether the user is there', async () => {
    expect((await remoteAccess(t.db, t.workspaceId)).switches.notifyAwayOnly).toBe(true);
    expect(toMac).toEqual([{ kind: 'presence:status' }]);
    expect(presence.present()).toBeNull();
  });

  it('holds a card push while the user is at the Mac and sends it when they go idle', async () => {
    await atMac(true);
    await ask();
    await finish();
    expect(sent).toEqual([]);
    await atMac(false);
    expect(bodies()).toEqual(['Needs your approval · Finished']);
  });

  it('drops a held push read on the Mac before the user left', async () => {
    await atMac(true);
    await ask();
    await finish();
    await t.db.query(
      `UPDATE conversations SET seen_at = now() + interval '1 second' WHERE id = $1`,
      [chat.conversationId],
    );
    await markAttention(t.db, t.workspaceId, `run-done:${chat.runId}`, 'read');
    await atMac(false);
    expect(sent).toEqual([]);
  });

  it('sends each held push once, however often the user comes and goes', async () => {
    await atMac(true);
    await ask();
    await atMac(false);
    await atMac(true);
    await atMac(false);
    expect(bodies()).toEqual(['Needs your approval']);
  });

  it('sends at once when presence is unknown, the user is away, or the switch is off', async () => {
    await ask();
    await atMac(false);
    await finish();
    await saveRemoteSwitches(t.db, t.workspaceId, { notifyAwayOnly: false });
    await atMac(true);
    await ask();
    expect(bodies()).toEqual(['Needs your approval', 'Finished', 'Needs your approval']);
  });

  it('sends a meeting alert held at the Mac only if the meeting has not started', async () => {
    await atMac(true);
    notifier.meeting(clock + 10 * MINUTE);
    await notifier.settled();
    expect(sent).toEqual([]);
    clock += 4 * MINUTE;
    await atMac(false);
    expect(sent.map((delivery) => JSON.parse(delivery.payload) as unknown)).toEqual([
      { title: 'Meeting in 6 min', body: '', chatId: null, tag: 'spark-meeting' },
    ]);

    await atMac(true);
    notifier.meeting(clock + 2 * MINUTE);
    await notifier.settled();
    clock += 3 * MINUTE;
    await atMac(false);
    expect(sent).toHaveLength(1);
  });

  it('keeps the soonest held meeting when two come due at the Mac', async () => {
    await atMac(true);
    notifier.meeting(clock + 10 * MINUTE);
    await notifier.settled();
    clock += 5 * MINUTE;
    notifier.meeting(clock + 10 * MINUTE);
    await notifier.settled();
    clock += 3 * MINUTE;
    await atMac(false);
    expect(titles()).toEqual(['Meeting in 2 min']);
  });

  it('sends the next held meeting when the soonest one has started by the time the user leaves', async () => {
    const at = clock;
    await atMac(true);
    notifier.meeting(at + 10 * MINUTE);
    await notifier.settled();
    clock = at + 5 * MINUTE;
    notifier.meeting(at + 15 * MINUTE);
    await notifier.settled();
    clock = at + 11 * MINUTE;
    await atMac(false);
    expect(titles()).toEqual(['Meeting in 4 min']);
  });

  it('never sends a held meeting alert in the seconds after the meeting started', async () => {
    const start = clock + 90_000;
    await atMac(true);
    notifier.meeting(start);
    await notifier.settled();
    clock = start + 20_000;
    await atMac(false);
    expect(sent).toEqual([]);
  });

  it('says Meeting in 1 min for a held meeting seconds away', async () => {
    const start = clock + 2 * MINUTE;
    await atMac(true);
    notifier.meeting(start);
    await notifier.settled();
    clock = start - 20_000;
    await atMac(false);
    expect(titles()).toEqual(['Meeting in 1 min']);
  });

  it('forgets held pushes on restart and never sends them, or anything twice, afterwards', async () => {
    await atMac(true);
    await ask();
    await notifier.stop();
    startNotifier(new Date());
    await atMac(true);
    await atMac(false);
    notifier.changed({ kind: 'approval', conversationId: chat.conversationId, runId: chat.runId });
    await notifier.settled();
    expect(sent).toEqual([]);
  });

  it('ignores a presence message it cannot read', async () => {
    await atMac(true);
    fromMac?.({ kind: 'presence:state', present: 'yes' });
    await ask();
    expect(presence.present()).toBe(true);
    expect(sent).toEqual([]);
  });
});

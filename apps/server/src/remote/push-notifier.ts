import {
  terminalAttentionKey,
  type AppEvent,
  type PushTestResult,
  type RemoteAccess,
} from '@spark-outpost/contracts';
import { listAttentionItems, readAttentionKeys } from '../persistence/attention-items.ts';
import type { Db } from '../persistence/db.ts';
import type { ClientFocus } from '../slack/client-focus.ts';
import { chatOf } from '../slack/notifier.ts';
import { NotifyBatcher } from '../slack/notify-plan.ts';
import type { PushKeys, VapidKeys } from './push-keys.ts';
import {
  closePush,
  isPushEndpoint,
  meetingPush,
  pushMessage,
  quietDevice,
  SentKeys,
  TerminalWaits,
  testPush,
  type QueuedPush,
} from './push-plan.ts';
import { pushSubject } from './push-contact.ts';
import type { PushResult, PushSend } from './push-send.ts';
import { forgetPushSubscription, pushContact, pushTargets, type PushTarget } from './push-store.ts';
import { recordRemoteAudit, remoteAccess } from './store.ts';

export const PUSH_BATCH_MS = 8000;
const WATCHED_KINDS = new Set(['approval', 'run', 'conversation']);
const SETTLE_KINDS = new Set(['approval', 'run', 'conversation', 'seen', 'attention']);

export interface PushNotifierDeps {
  db: Db;
  workspaceId: string;
  keys: PushKeys;
  focus: Pick<ClientFocus, 'focusedClients'>;
  send: PushSend;
  held?: () => boolean;
  present?: () => boolean | null;
}

export interface PushNotifierOptions {
  batchMs?: number;
  since?: Date;
  now?: () => number;
}

export interface PushNotifier {
  changed(event: AppEvent): void;
  meeting(minutes: number): void;
  test(deviceId: string): Promise<PushTestResult>;
  release(): void;
  settled(): Promise<void>;
  stop(): Promise<void>;
}

interface Sender {
  keys: VapidKeys;
  subject: string;
}

interface WaitingRow {
  kind: 'approval' | 'terminal';
  id: string;
  detail: string;
  generation: number;
  since: Date;
  seen: boolean;
}

export function startPushNotifier(
  deps: PushNotifierDeps,
  options: PushNotifierOptions = {},
): PushNotifier {
  const { db, workspaceId } = deps;
  const since = options.since ?? new Date();
  const now = options.now ?? Date.now;
  const sent = new SentKeys();
  const terminals = new TerminalWaits();
  const scanning = new Set<string>();
  const heldChats = new Map<string, QueuedPush[]>();
  const shown = new Map<string, { keys: Set<string>; targets: Set<string> }>();
  let heldMeetingStart: number | null = null;
  let stopped = false;
  let work: Promise<void> = Promise.resolve();

  const enqueue = (task: () => Promise<void>) => {
    work = work.then(task).catch((error: unknown) => {
      console.error('Push notification failed', (error as Error).message);
    });
  };

  async function waiting(conversationId: string): Promise<QueuedPush[]> {
    const { rows } = await db.query<WaitingRow>(
      `SELECT w.kind, w.id, w.detail, w.generation, w.since,
         COALESCE(c.seen_at >= w.since, false) AS seen
       FROM (
         SELECT 'approval' AS kind, a.id::text AS id, a.kind AS detail, 0 AS generation,
           a.created_at AS since
         FROM approvals a JOIN runs r ON r.id = a.run_id
         WHERE r.conversation_id = $1 AND a.status = 'pending' AND a.created_at >= $2
         UNION ALL
         SELECT 'terminal', t.id::text, t.state, t.generation,
           COALESCE(t.waiting_since, t.updated_at)
         FROM native_terminal_sessions t
         WHERE t.conversation_id = $1 AND COALESCE(t.waiting_since, t.updated_at) >= $2
       ) w
       LEFT JOIN conversations c ON c.id = $1 AND c.workspace_id = $3`,
      [conversationId, since, workspaceId],
    );
    return rows.flatMap((row): QueuedPush[] => {
      const { detail, seen } = row;
      if (row.kind === 'approval') {
        const source = `approval:${row.id}`;
        return [{ key: source, source, kind: 'approval', detail, seen, cardId: row.id }];
      }
      const key = terminals.key(row.id, row.generation, row.detail);
      const source = terminalAttentionKey(row.id, row.generation, row.since);
      return key ? [{ key, source, kind: 'terminal', detail, seen }] : [];
    });
  }

  async function finishedTurns(conversationId: string): Promise<QueuedPush[]> {
    const items = await listAttentionItems(db, workspaceId, conversationId);
    return items.flatMap((item): QueuedPush[] => {
      const { kind } = item;
      if (kind !== 'run-done' && kind !== 'run-failed') return [];
      const open = !item.readAt && !item.setAsideAt && !item.dismissedAt;
      if (!open || new Date(item.at) < since) return [];
      return [{ key: item.key, source: item.key, kind, detail: null, seen: false }];
    });
  }

  async function sendTo(
    target: PushTarget,
    payload: string,
    sender: Sender,
  ): Promise<PushResult | null> {
    if (!isPushEndpoint(target.endpoint)) return null;
    const result = await deps.send({
      endpoint: target.endpoint,
      p256dh: target.p256dh,
      auth: target.auth,
      payload,
      keys: sender.keys,
      subject: sender.subject,
    });
    if (result.outcome === 'gone') await forgetPushSubscription(db, target.id);
    await recordRemoteAudit(db, workspaceId, {
      action: 'notification_sent',
      device: { id: target.deviceId, name: target.deviceName },
      ...(result.status === null ? {} : { status: result.status }),
      detail: {
        outcome: result.outcome,
        ...(result.reason === null ? {} : { reason: result.reason }),
      },
    });
    return result;
  }

  async function sender(
    reaches: (target: PushTarget) => boolean = (target) =>
      !quietDevice(target.deviceId, deps.focus.focusedClients()),
  ): Promise<{ targets: PushTarget[]; sender: Sender } | null> {
    const access = await remoteAccess(db, workspaceId);
    if (!access.hostname || !access.switches.notifications) return null;
    const targets = (await pushTargets(db, workspaceId, access.hostname)).filter(reaches);
    if (targets.length === 0) return null;
    const keys = await deps.keys.get();
    const subject = pushSubject(await pushContact(db, workspaceId), access.hostname);
    return {
      targets: targets.filter((target) => target.serverKey === keys.publicKey),
      sender: { keys, subject },
    };
  }

  async function meetingDue(minutes: number): Promise<void> {
    if (atMac(await remoteAccess(db, workspaceId))) {
      const start = now() + minutes * 60_000;
      const held = heldMeetingStart;
      heldMeetingStart = held !== null && held > now() ? Math.min(held, start) : start;
      return;
    }
    await sendMeeting(minutes);
  }

  async function releaseMeeting(): Promise<void> {
    const start = heldMeetingStart;
    heldMeetingStart = null;
    if (start === null || now() >= start) return;
    await meetingDue(Math.ceil((start - now()) / 60_000));
  }

  async function sendMeeting(minutes: number): Promise<void> {
    const ready = await sender();
    if (!ready) return;
    const payload = JSON.stringify(meetingPush(minutes));
    await Promise.all(ready.targets.map((target) => sendTo(target, payload, ready.sender)));
  }

  async function sendTest(deviceId: string): Promise<PushTestResult> {
    const access = await remoteAccess(db, workspaceId);
    if (!access.hostname || !access.switches.notifications) return { outcome: 'off', reason: null };
    const ready = await sender((target) => target.deviceId === deviceId);
    if (!ready || ready.targets.length === 0) return { outcome: 'none', reason: null };
    const payload = JSON.stringify(testPush());
    const results = await Promise.all(
      ready.targets.map((target) => sendTo(target, payload, ready.sender)),
    );
    if (results.some((result) => result?.outcome === 'sent'))
      return { outcome: 'sent', reason: null };
    if (results.every((result) => result?.outcome === 'gone'))
      return { outcome: 'gone', reason: null };
    const refused = results.find((result) => result?.outcome === 'failed');
    return { outcome: 'failed', reason: refused?.reason ?? null };
  }

  const atMac = (access: RemoteAccess) =>
    access.switches.notifyAwayOnly && deps.present?.() === true;

  async function deliver(conversationId: string, items: QueuedPush[]): Promise<void> {
    const access = await remoteAccess(db, workspaceId);
    if (deps.held?.() || atMac(access)) {
      heldChats.set(conversationId, [...(heldChats.get(conversationId) ?? []), ...items]);
      return;
    }
    const alerting = await alertingSources(conversationId, access.switches.notifyUpdates);
    const live = items.filter((item) => alerting.has(item.source));
    if (live.length === 0) return;
    const ready = await sender();
    if (!ready) return;
    const chat = await chatOf({ db, workspaceId }, conversationId);
    if (!chat) return;
    const payload = JSON.stringify(pushMessage(chat, live));
    await Promise.all(ready.targets.map((target) => sendTo(target, payload, ready.sender)));
    const record = shown.get(conversationId) ?? { keys: new Set<string>(), targets: new Set() };
    for (const item of live) record.keys.add(item.source);
    for (const target of ready.targets) record.targets.add(target.id);
    shown.set(conversationId, record);
  }

  async function alertingSources(conversationId: string, withTurns: boolean): Promise<Set<string>> {
    const unseen = (await waiting(conversationId)).filter((item) => !item.seen);
    const turns = withTurns ? await finishedTurns(conversationId) : [];
    const sources = [...unseen, ...turns].map((item) => item.source);
    const read = await readAttentionKeys(db, workspaceId, sources);
    return new Set(sources.filter((source) => !read.has(source)));
  }

  async function settle(conversationId: string): Promise<void> {
    const record = shown.get(conversationId);
    if (!record) return;
    const alerting = await alertingSources(conversationId, true);
    if ([...record.keys].some((key) => alerting.has(key))) return;
    shown.delete(conversationId);
    const ready = await sender((target) => record.targets.has(target.id));
    if (!ready) return;
    const payload = JSON.stringify(closePush(conversationId, [...record.keys]));
    await Promise.all(ready.targets.map((target) => sendTo(target, payload, ready.sender)));
  }

  const batcher = new NotifyBatcher<QueuedPush>(
    options.batchMs ?? PUSH_BATCH_MS,
    (conversationId, items) => enqueue(() => deliver(conversationId, items)),
  );

  async function scan(conversationId: string): Promise<void> {
    scanning.delete(conversationId);
    const access = await remoteAccess(db, workspaceId);
    const turns = await finishedTurns(conversationId);
    const reaches = access.hostname !== null && access.switches.notifications;
    for (const candidate of [...(await waiting(conversationId)), ...turns]) {
      if (!sent.claim(candidate.key)) continue;
      const wanted = candidate.kind.startsWith('run-') ? access.switches.notifyUpdates : true;
      if (reaches && wanted) batcher.add(conversationId, candidate);
    }
  }

  return {
    changed(event) {
      const { conversationId } = event;
      if (stopped || !conversationId) return;
      if (SETTLE_KINDS.has(event.kind) && shown.has(conversationId)) {
        enqueue(() => settle(conversationId));
      }
      if (!WATCHED_KINDS.has(event.kind)) return;
      if (scanning.has(conversationId)) return;
      scanning.add(conversationId);
      enqueue(() => scan(conversationId));
    },
    meeting(minutes) {
      if (stopped || deps.held?.()) return;
      enqueue(() => meetingDue(minutes));
    },
    test(deviceId) {
      return sendTest(deviceId);
    },
    release() {
      if (stopped) return;
      const waiting = [...heldChats];
      heldChats.clear();
      for (const [conversationId, items] of waiting) {
        enqueue(() => deliver(conversationId, items));
      }
      if (deps.held?.()) heldMeetingStart = null;
      else enqueue(releaseMeeting);
    },
    async settled() {
      await work;
      batcher.releaseAll();
      await work;
    },
    async stop() {
      stopped = true;
      batcher.releaseAll();
      await work;
    },
  };
}

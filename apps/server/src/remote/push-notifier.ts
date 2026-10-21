import { terminalAttentionKey, type AppEvent } from '@spark-outpost/contracts';
import { readAttentionKeys } from '../persistence/attention-items.ts';
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
  unseenPushes,
  type QueuedPush,
} from './push-plan.ts';
import { pushSubject } from './push-contact.ts';
import type { PushSend } from './push-send.ts';
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
}

export interface PushNotifierOptions {
  batchMs?: number;
  since?: Date;
}

export interface PushNotifier {
  changed(event: AppEvent): void;
  meeting(minutes: 5 | 10 | 15): void;
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
}

export function startPushNotifier(
  deps: PushNotifierDeps,
  options: PushNotifierOptions = {},
): PushNotifier {
  const { db, workspaceId } = deps;
  const since = options.since ?? new Date();
  const sent = new SentKeys();
  const terminals = new TerminalWaits();
  const scanning = new Set<string>();
  const heldChats = new Map<string, QueuedPush[]>();
  const shown = new Map<string, { keys: Set<string>; targets: Set<string> }>();
  let stopped = false;
  let work: Promise<void> = Promise.resolve();

  const enqueue = (task: () => Promise<void>) => {
    work = work.then(task).catch((error: unknown) => {
      console.error('Push notification failed', (error as Error).message);
    });
  };

  async function waiting(conversationId: string): Promise<QueuedPush[]> {
    const { rows } = await db.query<WaitingRow>(
      `SELECT 'approval' AS kind, a.id::text AS id, a.kind AS detail, 0 AS generation,
         a.created_at AS since
       FROM approvals a JOIN runs r ON r.id = a.run_id
       WHERE r.conversation_id = $1 AND a.status = 'pending' AND a.created_at >= $2
       UNION ALL
       SELECT 'terminal', t.id::text, t.state, t.generation,
         COALESCE(t.waiting_since, t.updated_at)
       FROM native_terminal_sessions t
       WHERE t.conversation_id = $1 AND COALESCE(t.waiting_since, t.updated_at) >= $2`,
      [conversationId, since],
    );
    return rows.flatMap((row): QueuedPush[] => {
      const at = row.since.getTime();
      if (row.kind === 'approval') {
        const source = `approval:${row.id}`;
        return [{ key: source, source, kind: 'approval', detail: row.detail, at }];
      }
      const key = terminals.key(row.id, row.generation, row.detail);
      const source = terminalAttentionKey(row.id, row.generation, row.since);
      return key ? [{ key, source, kind: 'terminal', detail: row.detail, at }] : [];
    });
  }

  async function seenAt(conversationId: string): Promise<Date | null> {
    const { rows } = await db.query<{ seen_at: Date | null }>(
      'SELECT seen_at FROM conversations WHERE id = $1 AND workspace_id = $2',
      [conversationId, workspaceId],
    );
    return rows[0]?.seen_at ?? null;
  }

  async function sendTo(target: PushTarget, payload: string, sender: Sender): Promise<void> {
    if (!isPushEndpoint(target.endpoint)) return;
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

  async function sendMeeting(minutes: 5 | 10 | 15): Promise<void> {
    const ready = await sender();
    if (!ready) return;
    const payload = JSON.stringify(meetingPush(minutes));
    await Promise.all(ready.targets.map((target) => sendTo(target, payload, ready.sender)));
  }

  async function deliver(conversationId: string, items: QueuedPush[]): Promise<void> {
    if (deps.held?.()) {
      heldChats.set(conversationId, [...(heldChats.get(conversationId) ?? []), ...items]);
      return;
    }
    const alerting = await alertingSources(conversationId);
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

  async function alertingSources(conversationId: string): Promise<Set<string>> {
    const waitingNow = unseenPushes(await waiting(conversationId), await seenAt(conversationId));
    const sources = waitingNow.map((item) => item.source);
    const read = await readAttentionKeys(db, workspaceId, sources);
    return new Set(sources.filter((source) => !read.has(source)));
  }

  async function settle(conversationId: string): Promise<void> {
    const record = shown.get(conversationId);
    if (!record) return;
    const alerting = await alertingSources(conversationId);
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
    for (const candidate of await waiting(conversationId)) {
      if (!sent.claim(candidate.key)) continue;
      if (access.hostname && access.switches.notifications) batcher.add(conversationId, candidate);
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
      enqueue(() => sendMeeting(minutes));
    },
    release() {
      if (stopped) return;
      const waiting = [...heldChats];
      heldChats.clear();
      for (const [conversationId, items] of waiting) {
        enqueue(() => deliver(conversationId, items));
      }
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

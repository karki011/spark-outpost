import type { AppEvent } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import type { ClientFocus } from '../slack/client-focus.ts';
import { chatOf } from '../slack/notifier.ts';
import { NotifyBatcher } from '../slack/notify-plan.ts';
import type { PushKeys, VapidKeys } from './push-keys.ts';
import {
  isPushEndpoint,
  pushMessage,
  quietDevice,
  SentKeys,
  TerminalWaits,
  type PushCandidate,
} from './push-plan.ts';
import type { PushSend } from './push-send.ts';
import { forgetPushSubscription, pushTargets, type PushTarget } from './push-store.ts';
import { recordRemoteAudit, remoteAccess } from './store.ts';

export const PUSH_BATCH_MS = 8000;
const WATCHED_KINDS = new Set(['approval', 'run', 'conversation']);

export interface PushNotifierDeps {
  db: Db;
  workspaceId: string;
  keys: PushKeys;
  focus: Pick<ClientFocus, 'focusedClients'>;
  send: PushSend;
}

export interface PushNotifierOptions {
  batchMs?: number;
  since?: Date;
}

export interface PushNotifier {
  changed(event: AppEvent): void;
  settled(): Promise<void>;
  stop(): Promise<void>;
}

interface WaitingRow {
  kind: 'approval' | 'terminal';
  id: string;
  detail: string;
  generation: number;
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
  let stopped = false;
  let work: Promise<void> = Promise.resolve();

  const enqueue = (task: () => Promise<void>) => {
    work = work.then(task).catch((error: unknown) => {
      console.error('Push notification failed', (error as Error).message);
    });
  };

  async function waiting(conversationId: string): Promise<PushCandidate[]> {
    const { rows } = await db.query<WaitingRow>(
      `SELECT 'approval' AS kind, a.id::text AS id, a.kind AS detail, 0 AS generation
       FROM approvals a JOIN runs r ON r.id = a.run_id
       WHERE r.conversation_id = $1 AND a.status = 'pending' AND a.created_at >= $2
       UNION ALL
       SELECT 'terminal', t.id::text, t.state, t.generation FROM native_terminal_sessions t
       WHERE t.conversation_id = $1 AND t.updated_at >= $2`,
      [conversationId, since],
    );
    return rows.flatMap((row): PushCandidate[] => {
      if (row.kind === 'approval') {
        const source = `approval:${row.id}`;
        return [{ key: source, source, kind: 'approval', detail: row.detail }];
      }
      const key = terminals.key(row.id, row.generation, row.detail);
      return key ? [{ key, source: key, kind: 'terminal', detail: row.detail }] : [];
    });
  }

  async function sendTo(target: PushTarget, payload: string, keys: VapidKeys): Promise<void> {
    if (!isPushEndpoint(target.endpoint)) return;
    const outcome = await deps.send({
      endpoint: target.endpoint,
      p256dh: target.p256dh,
      auth: target.auth,
      payload,
      keys,
    });
    if (outcome === 'gone') await forgetPushSubscription(db, target.id);
    await recordRemoteAudit(db, workspaceId, {
      action: 'notification_sent',
      device: { id: target.deviceId, name: target.deviceName },
      detail: { outcome },
    });
  }

  async function deliver(conversationId: string, items: PushCandidate[]): Promise<void> {
    const still = new Set((await waiting(conversationId)).map((item) => item.source));
    const live = items.filter((item) => still.has(item.source));
    if (live.length === 0) return;
    const access = await remoteAccess(db, workspaceId);
    if (!access.hostname || !access.switches.notifications) return;
    const chat = await chatOf({ db, workspaceId }, conversationId);
    if (!chat) return;
    const focused = deps.focus.focusedClients();
    const targets = (await pushTargets(db, workspaceId, access.hostname)).filter(
      (target) => !quietDevice(target.deviceId, focused),
    );
    if (targets.length === 0) return;
    const keys = await deps.keys.get();
    const payload = JSON.stringify(pushMessage(chat, live));
    for (const target of targets) {
      if (target.serverKey === keys.publicKey) await sendTo(target, payload, keys);
    }
  }

  const batcher = new NotifyBatcher<PushCandidate>(
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
      if (stopped || !conversationId || !WATCHED_KINDS.has(event.kind)) return;
      if (scanning.has(conversationId)) return;
      scanning.add(conversationId);
      enqueue(() => scan(conversationId));
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

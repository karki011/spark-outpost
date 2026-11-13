import type { AppEvent } from '@spark-outpost/contracts';
import {
  claimSlackDelivery,
  conversationReadSlackDms,
  getSlackConnection,
  setSlackProblem,
  settleSlackDeliveries,
  slackChatThread,
} from '../persistence/slack.ts';
import { openSlack, slackNotifyTarget, type SlackDeps } from './connection.ts';
import {
  NotifyBatcher,
  notificationText,
  notifyDecision,
  threadUpdateText,
  type NotifyCandidate,
  type NotifyChat,
} from './notify-plan.ts';
import { ClientFocus, DEFAULT_FOCUS_CLIENT } from './client-focus.ts';
import { sendSlackMessage } from './post.ts';

export const NOTIFY_BATCH_MS = 20_000;
export const FOCUS_TTL_MS = 45_000;
export const DIRECT_CHAT_TITLE = 'A chat that read your Slack direct messages';
const WATCHED_KINDS = new Set(['approval', 'run', 'conversation', 'pull_request', 'task']);

export interface SlackNotifierOptions {
  batchMs?: number;
  focus?: ClientFocus;
  now?: () => number;
  since?: Date;
  linkScheme?: string | undefined;
}

export interface SlackNotifier {
  changed(event: AppEvent): void;
  setFocused(focused: boolean, clientId?: string): void;
  settled(): Promise<void>;
  stop(): Promise<void>;
}

interface Claimed extends NotifyCandidate {
  deliveryId: string;
}

async function candidates(
  deps: SlackDeps,
  conversationId: string,
  since: Date,
): Promise<NotifyCandidate[]> {
  const { rows } = await deps.db.query<NotifyCandidate>(
    `SELECT 'approval:' || a.id AS key, 'needs_you' AS event, a.kind AS detail, NULL AS url
     FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1 AND a.status = 'pending' AND a.created_at >= $2
     UNION ALL
     SELECT 'run:' || latest.id, CASE latest.status WHEN 'failed' THEN 'failed' ELSE 'finished' END,
       NULL, NULL
     FROM (
       SELECT id, status, finished_at FROM runs
       WHERE conversation_id = $1 AND parent_run_id IS NULL
       ORDER BY created_at DESC LIMIT 1
     ) latest
     WHERE latest.status IN ('succeeded', 'failed') AND latest.finished_at >= $2
     UNION ALL
     SELECT 'pr:' || w.id, 'pr_opened', NULL, w.url FROM pr_watches w
     WHERE w.conversation_id = $1 AND w.created_at >= $2
       AND w.opened_via IN ('ship', 'agent')
     UNION ALL
     SELECT 'flag:' || f.id, 'flag', NULL, NULL FROM rail_flags f
     WHERE f.conversation_id = $1 AND f.status = 'open' AND f.created_at >= $2`,
    [conversationId, since],
  );
  return rows;
}

export async function chatOf(
  deps: Pick<SlackDeps, 'db' | 'workspaceId'>,
  conversationId: string,
): Promise<NotifyChat | null> {
  const { rows } = await deps.db.query<{ title: string; project: string | null }>(
    `SELECT c.title, (
       SELECT p.name FROM conversation_projects cp JOIN projects p ON p.id = cp.project_id
       WHERE cp.conversation_id = c.id ORDER BY cp.position LIMIT 1
     ) AS project
     FROM conversations c WHERE c.id = $1 AND c.workspace_id = $2
       AND c.kind NOT IN ('digest', 'crew')`,
    [conversationId, deps.workspaceId],
  );
  if (!rows[0]) return null;
  const direct = await conversationReadSlackDms(deps.db, conversationId);
  return { conversationId, ...rows[0], ...(direct ? { title: DIRECT_CHAT_TITLE } : {}) };
}

async function stillWaiting(deps: SlackDeps, items: readonly Claimed[]): Promise<Set<string>> {
  const ids = items
    .filter((item) => item.event === 'needs_you')
    .map((item) => item.key.replace('approval:', ''));
  if (ids.length === 0) return new Set();
  const { rows } = await deps.db.query<{ id: string }>(
    "SELECT id FROM approvals WHERE id = ANY($1::uuid[]) AND status = 'pending'",
    [ids],
  );
  return new Set(rows.map((row) => `approval:${row.id}`));
}

export function startSlackNotifier(
  deps: SlackDeps,
  options: SlackNotifierOptions = {},
): SlackNotifier {
  const now = options.now ?? Date.now;
  const since = options.since ?? new Date(now());
  const focus = options.focus ?? new ClientFocus(now, FOCUS_TTL_MS);
  let stopped = false;
  let work: Promise<void> = Promise.resolve();
  const scanning = new Set<string>();

  const enqueue = (task: () => Promise<void>) => {
    work = work.then(task).catch((error: unknown) => {
      console.error('Slack notification failed', (error as Error).message);
    });
  };

  async function deliver(conversationId: string, items: Claimed[]): Promise<void> {
    const ids = items.map((item) => item.deliveryId);
    const waiting = await stillWaiting(deps, items);
    const live = items.filter((item) => item.event !== 'needs_you' || waiting.has(item.key));
    const resolved = items.filter((item) => !live.includes(item));
    await settleSlackDeliveries(
      deps.db,
      resolved.map((item) => item.deliveryId),
      'skipped',
      'resolved',
    );
    const [open, chat] = await Promise.all([openSlack(deps), chatOf(deps, conversationId)]);
    const target = open ? slackNotifyTarget(open.connection) : null;
    const liveIds = live.map((item) => item.deliveryId);
    if (live.length === 0) return;
    if (!open || !chat || !target) {
      await settleSlackDeliveries(deps.db, liveIds, 'skipped', 'no_target');
      return;
    }
    try {
      await sendSlackMessage(deps, open, {
        channel: target,
        mrkdwn: notificationText(chat, live, options.linkScheme),
      });
      await settleSlackDeliveries(deps.db, liveIds, 'sent');
      if (open.connection.problem) await setSlackProblem(deps.db, deps.workspaceId, null);
    } catch (error) {
      const message = (error as Error).message;
      await settleSlackDeliveries(deps.db, ids, 'failed', message);
      await setSlackProblem(deps.db, deps.workspaceId, `Couldn't send a notification: ${message}`);
    }
  }

  const batcher = new NotifyBatcher<Claimed>(
    options.batchMs ?? NOTIFY_BATCH_MS,
    (conversationId, items) => enqueue(() => deliver(conversationId, items)),
  );

  async function updateThread(conversationId: string, candidate: NotifyCandidate): Promise<void> {
    const text = threadUpdateText(candidate);
    if (!text) return;
    const thread = await slackChatThread(deps.db, conversationId);
    if (!thread?.postUpdates) return;
    const claimed = await claimSlackDelivery(deps.db, deps.workspaceId, {
      key: `thread:${candidate.key}`,
      kind: `thread_${candidate.event}`,
      conversationId,
    });
    if (!claimed) return;
    const open = await openSlack(deps);
    if (open?.connection.method === 'sign_in') {
      await settleSlackDeliveries(deps.db, [claimed], 'skipped', 'needs_own_app');
      return;
    }
    if (!open || !open.connection.settings.postUpdatesToThread) {
      await settleSlackDeliveries(deps.db, [claimed], 'skipped', 'off');
      return;
    }
    try {
      await sendSlackMessage(deps, open, {
        channel: thread.channelId,
        mrkdwn: text,
        threadTs: thread.threadTs,
      });
      await settleSlackDeliveries(deps.db, [claimed], 'sent');
    } catch (error) {
      await settleSlackDeliveries(deps.db, [claimed], 'failed', (error as Error).message);
    }
  }

  async function scan(conversationId: string): Promise<void> {
    scanning.delete(conversationId);
    const connection = await getSlackConnection(deps.db, deps.workspaceId);
    if (!connection) return;
    const facts = {
      settings: connection.settings,
      focused: focus.anyFocused(),
      target: slackNotifyTarget(connection),
    };
    for (const candidate of await candidates(deps, conversationId, since)) {
      await updateThread(conversationId, candidate);
      const deliveryId = await claimSlackDelivery(deps.db, deps.workspaceId, {
        key: candidate.key,
        kind: candidate.event,
        conversationId,
      });
      if (!deliveryId) continue;
      const decision = notifyDecision(candidate, facts);
      if (decision === 'send') batcher.add(conversationId, { ...candidate, deliveryId });
      else await settleSlackDeliveries(deps.db, [deliveryId], 'skipped', decision);
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
    setFocused(next, clientId = DEFAULT_FOCUS_CLIENT) {
      focus.set(clientId, next);
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

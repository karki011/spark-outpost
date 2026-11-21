import type { AppEvent } from '@spark-outpost/contracts';
import { addToQueue } from '../persistence/chat-queue.ts';
import {
  missedSteeredAsks,
  returnAskToWaiting,
  undeliveredAskIds,
  waitingAsksWithEndedTurn,
  type EndedAsk,
  type MissedAsk,
} from '../persistence/chat-asks.ts';
import { withTransaction, type Db } from '../persistence/db.ts';
import { removeMemberMessages } from '../persistence/member-messages.ts';
import type { ShipDeps } from '../ship/prepare.ts';
import { chatTarget, type ResolveTarget } from '../workflow/queue-drain.ts';
import { auditAskEnd, endNoReply, NO_REPLY_REASONS, recordReply } from './asks.ts';
import { deliverAsk, errorName } from './deliver-ask.ts';
import { TAKEN_FROM_TURN } from './message-prompt.ts';
import { releaseHeld } from './release.ts';
import type { ReadBranchWork } from './report-facts.ts';
import { refreshReports, reportsToParent, sendReport } from './reports.ts';
import { queueWrapUps } from './wrap-ups.ts';

export interface PassOptions {
  ship?: ShipDeps | undefined;
  readWork?: ReadBranchWork | undefined;
}

async function requeue(db: Db, missed: MissedAsk): Promise<void> {
  await withTransaction(db, async (client) => {
    await client.query('SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [
      missed.conversationId,
    ]);
    await removeMemberMessages(client, [missed.id]);
    await returnAskToWaiting(client, missed.id);
    await addToQueue(
      client,
      missed.conversationId,
      { id: missed.id, content: missed.body, origin: 'chat' },
      'front',
    );
  });
}

function turnReply(ended: EndedAsk): string {
  if (ended.ask.deliveredAs === 'turn') return ended.finalReply.trim();
  const tail = ended.reply.slice(ended.steerOffset).trim();
  return tail ? `${tail}\n\n${TAKEN_FROM_TURN}` : '';
}

function noReplyReason(ended: EndedAsk): string {
  if (ended.runStatus === 'gone') return NO_REPLY_REASONS.gone;
  if (ended.runStatus === 'cancelled') return NO_REPLY_REASONS.stopped;
  return ended.runStatus === 'succeeded' ? NO_REPLY_REASONS.empty : NO_REPLY_REASONS.failed;
}

async function settle(db: Db, ended: EndedAsk): Promise<void> {
  const reply = ended.runStatus === 'succeeded' ? turnReply(ended) : '';
  if (reply) {
    const end = await recordReply(db, ended.ask, { fromRunId: ended.ask.runId, body: reply });
    if (end.settled) {
      const how = ended.ask.deliveredAs === 'turn' ? 'turn reply' : 'taken from its turn';
      await auditAskEnd(db, ended.ask, 'reply', how);
    }
    return;
  }
  const reason = noReplyReason(ended);
  const end = await endNoReply(db, ended.ask, reason);
  if (end.settled) await auditAskEnd(db, ended.ask, 'no_reply', reason);
}

async function settleOrReport(db: Db, ended: EndedAsk, options: PassOptions): Promise<void> {
  if (await reportsToParent(db, ended)) await sendReport(db, ended, options.readWork);
  else await settle(db, ended);
}

async function step(failure: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(`${failure} (${errorName(error)}).`);
  }
}

async function each<T>(failure: string, items: readonly T[], work: (item: T) => Promise<unknown>) {
  for (const item of items) await step(failure, () => work(item));
}

export async function deliveryPass(
  db: Db,
  resolveTarget: ResolveTarget,
  options: PassOptions = {},
): Promise<void> {
  await each('A missed message between chats was not queued', await missedSteeredAsks(db), (ask) =>
    requeue(db, ask),
  );
  await each(
    'A message between chats was not settled',
    await waitingAsksWithEndedTurn(db, ['task', 'message']),
    (ended) => settleOrReport(db, ended, options),
  );
  await step('Sub-chat reports were not refreshed', () => refreshReports(db, options.readWork));
  await step('Held sub-chats were not released', () =>
    releaseHeld({ db, resolveTarget, ship: options.ship }),
  );
  await step('A wrap-up was not written', () => queueWrapUps(db, options.readWork));
  await each('A message between chats was not delivered', await undeliveredAskIds(db), (id) =>
    deliverAsk(db, id, resolveTarget),
  );
}

export interface AskDelivery {
  changed(event: AppEvent): void;
  close(): Promise<void>;
}

const WAKES: ReadonlySet<AppEvent['kind']> = new Set(['sub_chats_changed', 'run', 'spark_pause']);

export function askDelivery(
  db: Db,
  resolveTarget: ResolveTarget = chatTarget(db),
  options: PassOptions = {},
): AskDelivery {
  let running: Promise<void> | null = null;
  let again = false;
  let closed = false;

  async function passes(): Promise<void> {
    do {
      again = false;
      await deliveryPass(db, resolveTarget, options).catch((error: unknown) =>
        console.error(`Messages between chats were not delivered (${errorName(error)}).`),
      );
    } while (again && !closed);
    running = null;
  }

  function wake(): void {
    if (closed) return;
    if (running) {
      again = true;
      return;
    }
    running = passes();
  }

  wake();
  return {
    changed(event) {
      if (WAKES.has(event.kind)) wake();
    },
    async close() {
      closed = true;
      await running;
    },
  };
}

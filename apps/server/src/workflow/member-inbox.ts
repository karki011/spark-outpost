import {
  MEMBER_MESSAGE_ACTIVITY,
  type ChatAsk,
  type MemberMessage,
} from '@spark-outpost/contracts';
import { addToQueue } from '../persistence/chat-queue.ts';
import { withTransaction, type Db } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import { handQueueToWaitingTurn } from '../persistence/queue-handoff.ts';
import {
  claimMemberMessages,
  markMissedMessages,
  markUnreadOnStop,
  removeMemberMessages,
  setMemberMessageStatus,
} from '../persistence/member-messages.ts';
import { runWaitingOn } from '../persistence/subagents.ts';
import { requestCancel } from '../persistence/runs.ts';
import { shotAnchor } from '../persistence/browser-screenshots.ts';
import { queuedAttachmentFiles } from '../persistence/attachments.ts';
import type {
  ProviderMessage,
  SteerOutcome,
  SteerRequests,
  TurnInbox,
} from '../providers/provider.ts';
import { steeredAsks, type RecordObservation } from '../sub-chats/steered-ask.ts';
import type { Append } from './agent-turn.ts';
import { runEvents } from './run-events.ts';

export const MESSAGE_HEADING = '## Message from the user';

export interface MemberInbox extends SteerRequests, TurnInbox {
  dispose(stopped?: boolean): Promise<void>;
}

interface InboxOptions {
  conversationId: string;
  runId: string;
  topRunId: string;
  pollMs: number;
  answerWaitMs?: number;
  append: Append;
  replySoFar?: () => { shown: string; held: number };
  observed?: RecordObservation;
}

const ANSWER_WAIT_MS = 5_000;

export function messagePrompt(messages: readonly Pick<MemberMessage, 'body'>[]): string {
  const bodies = messages.map((message) => message.body.trim());
  const shown = bodies.length === 1 ? bodies[0]! : bodies.map((body) => `- ${body}`).join('\n');
  return `${MESSAGE_HEADING}\n${shown}\n\nThe user sent this to you directly while you work. Act on it first, then finish what you were doing and reply with both.`;
}

export function openMemberInbox(db: Db, options: InboxOptions): MemberInbox {
  const { conversationId, runId, topRunId, append } = options;
  const anchor = () => {
    const reply = options.replySoFar?.();
    return reply ? shotAnchor(reply.shown, reply.held) : null;
  };
  let send: ((text: ProviderMessage) => Promise<SteerOutcome>) | null = null;
  let polling: Promise<void> | null = null;
  let inFlight: string[] = [];
  let done = false;
  let leave: () => void = () => undefined;
  const left = new Promise<'left'>((resolve) => {
    leave = () => resolve('left');
  });
  const handedBack = new Set<string>();
  const asks = steeredAsks(db, topRunId, options.observed);
  const fromChats = new Map<string, ChatAsk>();
  const asksAmong = (messages: readonly MemberMessage[]) =>
    messages.flatMap((message) => fromChats.get(message.id) ?? []);
  const handedOver = new Set<string>();
  const announce = (messages: readonly MemberMessage[], status: string) =>
    append(
      runEvents.activity(newId(), MEMBER_MESSAGE_ACTIVITY, {
        ids: messages.map((message) => message.id),
        status,
      }),
    );
  const interrupt = async (messages: readonly MemberMessage[]) => {
    await setMemberMessageStatus(
      db,
      messages.map((message) => message.id),
      'interrupting',
    );
    await announce(messages, 'interrupting');
    await requestCancel(db, topRunId);
  };
  const missed = async (messages: readonly MemberMessage[]) => {
    await setMemberMessageStatus(
      db,
      messages.map((message) => message.id),
      'missed',
    );
    await announce(messages, 'missed').catch(() => undefined);
  };
  const queueForLater = async (messages: readonly MemberMessage[]) => {
    for (const message of messages) handedBack.add(message.id);
    try {
      await withTransaction(db, async (client) => {
        await client.query('SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [
          conversationId,
        ]);
        await removeMemberMessages(
          client,
          messages.map((message) => message.id),
        );
        for (const { id, body, attachmentIds, annotations } of [...messages].reverse()) {
          const origin = fromChats.has(id) ? { origin: 'chat' as const } : {};
          await addToQueue(
            client,
            conversationId,
            { id, content: body, attachmentIds, annotations, ...origin },
            'front',
          );
        }
      });
    } catch {
      await missed(messages);
      return;
    }
    await announce(messages, 'queued');
  };
  const sendUnsteered = async (messages: readonly MemberMessage[]) => {
    const waits = (message: MemberMessage) =>
      handedOver.has(message.id) || fromChats.has(message.id);
    const queued = messages.filter(waits);
    const sentNow = messages.filter((message) => !waits(message));
    if (queued.length > 0) await queueForLater(queued);
    if (sentNow.length === 0) return;
    const onlyWaiting =
      sentNow.some((message) => message.attachmentIds?.length) ||
      (await runWaitingOn(db, topRunId)) > 0;
    await (onlyWaiting ? queueForLater(sentNow) : interrupt(sentNow));
  };
  const prompt = async (messages: readonly MemberMessage[]): Promise<ProviderMessage | null> => {
    const own = messages.filter((message) => !fromChats.has(message.id));
    const ids = messages.flatMap((message) => message.attachmentIds ?? []);
    try {
      const steered = await Promise.all(asksAmong(messages).map((ask) => asks.prompt(ask)));
      const text = [...(own.length > 0 ? [messagePrompt(own)] : []), ...steered].join('\n\n');
      return ids.length
        ? { text, attachments: await queuedAttachmentFiles(db, conversationId, ids) }
        : text;
    } catch {
      await missed(messages);
      return null;
    }
  };
  const claim = async (urgentOnly: boolean) => {
    const claimed = await claimMemberMessages(db, runId, topRunId, urgentOnly, anchor());
    if (claimed.length === 0) return claimed;
    try {
      for (const [id, ask] of await asks.among(claimed)) fromChats.set(id, ask);
      return claimed;
    } catch {
      await setMemberMessageStatus(
        db,
        claimed.map((item) => item.id),
        'queued',
      );
      return [];
    }
  };
  const handQueue = async () => {
    if (runId !== topRunId || !send) return;
    const moved = await handQueueToWaitingTurn(db, conversationId, topRunId, [...handedBack]);
    for (const id of moved) {
      handedBack.add(id);
      handedOver.add(id);
    }
  };
  const poll = async () => {
    if (done) return;
    await handQueue().catch(() => undefined);
    const claimed = await claim(send === null);
    if (claimed.length === 0) return;
    if (send) {
      const message = await prompt(claimed);
      if (message === null) return;
      inFlight = claimed.map((item) => item.id);
      const outcome = await Promise.race([send(message), left]);
      if (outcome === 'left') return;
      inFlight = [];
      if (outcome === 'later') {
        await setMemberMessageStatus(
          db,
          claimed.map((item) => item.id),
          'queued',
        );
        return;
      }
      if (outcome) {
        await asks.delivered(asksAmong(claimed));
        await announce(claimed, 'delivered');
        return;
      }
    }
    const urgent = claimed.filter((message) => message.urgency === 'now');
    const later = claimed.filter((message) => message.urgency !== 'now');
    await setMemberMessageStatus(
      db,
      later.map((message) => message.id),
      'queued',
    );
    if (urgent.length > 0) await sendUnsteered(urgent);
  };
  const timer = setInterval(() => {
    polling ??= poll()
      .catch(() => undefined)
      .finally(() => {
        polling = null;
      });
  }, options.pollMs);
  return {
    attach(sender) {
      send = sender;
      return () => {
        send = null;
      };
    },
    async take() {
      if (done) return null;
      const claimed = await claim(false);
      if (claimed.length === 0) return null;
      const message = await prompt(claimed);
      if (message === null) return null;
      await asks.delivered(asksAmong(claimed)).catch(() => undefined);
      await announce(claimed, 'delivered').catch(() => undefined);
      return message;
    },
    async dispose(stopped = false) {
      done = true;
      clearInterval(timer);
      if (stopped) leave();
      let gaveUp = false;
      const giveUp = setTimeout(() => {
        gaveUp = true;
        leave();
      }, options.answerWaitMs ?? ANSWER_WAIT_MS);
      await polling;
      clearTimeout(giveUp);
      if (stopped) await markUnreadOnStop(db, runId);
      else if (gaveUp && inFlight.length > 0) await setMemberMessageStatus(db, inFlight, 'missed');
      await markMissedMessages(db, runId);
    },
  };
}

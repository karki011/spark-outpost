import { MEMBER_MESSAGE_ACTIVITY, type MemberMessage } from '@spark-outpost/contracts';
import { addToQueue } from '../persistence/chat-queue.ts';
import { withTransaction, type Db } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
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
import type { ProviderMessage, SteerRequests, TurnInbox } from '../providers/provider.ts';
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
  append: Append;
  replySoFar?: () => { shown: string; held: number };
}

export function messagePrompt(messages: readonly Pick<MemberMessage, 'body'>[]): string {
  const bodies = messages.map((message) => message.body.trim());
  const shown = bodies.length === 1 ? bodies[0]! : bodies.map((body) => `- ${body}`).join('\n');
  return `${MESSAGE_HEADING}\n${shown}\n\nThe user sent this to you directly while you work. Act on it before anything else, then reply with what you changed.`;
}

export function openMemberInbox(db: Db, options: InboxOptions): MemberInbox {
  const { conversationId, runId, topRunId, append } = options;
  const anchor = () => {
    const reply = options.replySoFar?.();
    return reply ? shotAnchor(reply.shown, reply.held) : null;
  };
  let send: ((text: ProviderMessage) => Promise<boolean>) | null = null;
  let busy = false;
  let done = false;
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
          await addToQueue(
            client,
            conversationId,
            { id, content: body, attachmentIds, annotations },
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
    const onlyWaiting =
      messages.some((message) => message.attachmentIds?.length) ||
      (await runWaitingOn(db, topRunId)) > 0;
    await (onlyWaiting ? queueForLater(messages) : interrupt(messages));
  };
  const prompt = async (messages: readonly MemberMessage[]): Promise<ProviderMessage | null> => {
    const text = messagePrompt(messages);
    const ids = messages.flatMap((message) => message.attachmentIds ?? []);
    try {
      return ids.length
        ? { text, attachments: await queuedAttachmentFiles(db, conversationId, ids) }
        : text;
    } catch {
      await missed(messages);
      return null;
    }
  };
  const poll = async () => {
    if (busy || done) return;
    busy = true;
    try {
      const claimed = await claimMemberMessages(db, runId, topRunId, send === null, anchor());
      if (claimed.length === 0) return;
      if (send) {
        const message = await prompt(claimed);
        if (message === null) return;
        if (await send(message)) {
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
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void poll().catch(() => undefined), options.pollMs);
  return {
    attach(sender) {
      send = sender;
      return () => {
        send = null;
      };
    },
    async take() {
      if (done) return null;
      const claimed = await claimMemberMessages(db, runId, topRunId, false, anchor());
      if (claimed.length === 0) return null;
      const message = await prompt(claimed);
      if (message === null) return null;
      await announce(claimed, 'delivered').catch(() => undefined);
      return message;
    },
    async dispose(stopped = false) {
      done = true;
      clearInterval(timer);
      if (stopped) await markUnreadOnStop(db, runId);
      await markMissedMessages(db, runId);
    },
  };
}

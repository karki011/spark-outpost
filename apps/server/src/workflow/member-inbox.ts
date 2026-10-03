import { MEMBER_MESSAGE_ACTIVITY, type MemberMessage } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import {
  claimMemberMessages,
  markMissedMessages,
  setMemberMessageStatus,
} from '../persistence/member-messages.ts';
import { requestCancel } from '../persistence/runs.ts';
import type { SteerRequests, TurnInbox } from '../providers/provider.ts';
import type { Append } from './agent-turn.ts';
import { runEvents } from './run-events.ts';

export const MESSAGE_HEADING = '## Message from the user';

export interface MemberInbox extends SteerRequests, TurnInbox {
  dispose(): Promise<void>;
}

interface InboxOptions {
  runId: string;
  topRunId: string;
  pollMs: number;
  append: Append;
}

export function joinSteering(watches: readonly (SteerRequests | null)[]): SteerRequests | null {
  const present = watches.filter((watch): watch is SteerRequests => watch !== null);
  if (present.length <= 1) return present[0] ?? null;
  return {
    attach(send) {
      const detach = present.map((watch) => watch.attach(send));
      return () => detach.forEach((stop) => stop());
    },
  };
}

export function messagePrompt(messages: readonly Pick<MemberMessage, 'body'>[]): string {
  const bodies = messages.map((message) => message.body.trim());
  const shown = bodies.length === 1 ? bodies[0]! : bodies.map((body) => `- ${body}`).join('\n');
  return `${MESSAGE_HEADING}\n${shown}\n\nThe user sent this to you directly while you work. Act on it before anything else, then reply with what you changed.`;
}

export function openMemberInbox(db: Db, options: InboxOptions): MemberInbox {
  const { runId, topRunId, append } = options;
  let send: ((text: string) => Promise<boolean>) | null = null;
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
  const poll = async () => {
    if (busy || done) return;
    busy = true;
    try {
      const claimed = await claimMemberMessages(db, runId, topRunId, send === null);
      if (claimed.length === 0) return;
      if (send && (await send(messagePrompt(claimed)))) {
        await announce(claimed, 'delivered');
        return;
      }
      const urgent = claimed.filter((message) => message.urgency === 'now');
      const later = claimed.filter((message) => message.urgency !== 'now');
      await setMemberMessageStatus(
        db,
        later.map((message) => message.id),
        'queued',
      );
      if (urgent.length > 0) await interrupt(urgent);
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
      const claimed = await claimMemberMessages(db, runId, topRunId, false);
      if (claimed.length === 0) return null;
      await announce(claimed, 'delivered').catch(() => undefined);
      return messagePrompt(claimed);
    },
    async dispose() {
      done = true;
      clearInterval(timer);
      await markMissedMessages(db, runId);
    },
  };
}

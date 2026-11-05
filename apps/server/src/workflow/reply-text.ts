import type { RunEvent } from '@spark-outpost/contracts';
import { newId } from '../persistence/ids.ts';
import type { MessagePhase } from '../providers/provider.ts';
import { runEvents } from './run-events.ts';

interface ReplyResult {
  text: string;
  messageId: string | null;
  finalReply: string | null;
}

interface ReplyText {
  say(delta: string): Promise<void>;
  mark(phase: MessagePhase | undefined, held: number): boolean;
  result(): ReplyResult;
}

export function createReplyText(append: (event: RunEvent) => Promise<unknown>): ReplyText {
  let messageId: string | null = null;
  let text = '';
  let finalStart: number | null = null;
  let inFinal = false;
  const finalReply = () => (finalStart === null ? null : text.slice(finalStart).trim() || null);
  return {
    async say(delta) {
      if (!delta) return;
      if (!messageId) {
        messageId = newId();
        await append(runEvents.textStart(messageId));
      }
      text += delta;
      await append(runEvents.textContent(messageId, delta));
    },
    mark(phase, held) {
      const final = phase === 'final';
      const starts = final && !inFinal;
      if (starts) finalStart = text.length + held;
      inFinal = final;
      return starts;
    },
    result: () => ({ text, messageId, finalReply: finalReply() }),
  };
}

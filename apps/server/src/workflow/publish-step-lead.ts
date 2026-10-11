import { EventType, type RunEvent } from '@spark-outpost/contracts';
import { newId } from '../persistence/ids.ts';
import type { Append, TurnResult } from './agent-turn.ts';
import { runEvents } from './run-events.ts';

export interface HeldReply {
  append: Append;
  ledBy(reply: TurnResult, line: string): Promise<TurnResult>;
}

const leading = (line: string, text: string | null) => (text?.trim() ? `${line}\n\n${text}` : line);

export function holdReplyText(append: Append): HeldReply {
  const said: RunEvent[] = [];
  return {
    append: async (event, options) => {
      if (event.type === EventType.TEXT_MESSAGE_START) return null;
      if (event.type !== EventType.TEXT_MESSAGE_CONTENT) return append(event, options);
      said.push(event);
      return null;
    },
    async ledBy(reply, line) {
      const messageId = reply.messageId ?? newId();
      await append(runEvents.textStart(messageId));
      await append(runEvents.textContent(messageId, reply.text.trim() ? `${line}\n\n` : line));
      if (reply.text.trim()) for (const event of said) await append(event);
      const led = { ...reply, messageId, text: leading(line, reply.text) };
      return reply.finalReply ? { ...led, finalReply: leading(line, reply.finalReply) } : led;
    },
  };
}

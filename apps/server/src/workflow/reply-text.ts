import { createHash } from 'node:crypto';
import type { RunEvent } from '@spark-outpost/contracts';
import { newId } from '../persistence/ids.ts';
import type { AgentMessageRef } from '../persistence/run-events.ts';
import type { MessagePhase, ProviderOutput } from '../providers/provider.ts';
import { runEvents } from './run-events.ts';

interface ReplyResult {
  text: string;
  messageId: string | null;
  finalReply: string | null;
  agentMessages: AgentMessageRef[];
}

interface ReplyText {
  say(delta: string): Promise<void>;
  mark(phase: MessagePhase | undefined, held: number): boolean;
  noteAgent(output: Extract<ProviderOutput, { kind: 'text_delta' }>): void;
  text(): string;
  result(): ReplyResult;
}

const MESSAGE_SEPARATOR = '\n\n';

function fingerprint(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

export function createReplyText(append: (event: RunEvent) => Promise<unknown>): ReplyText {
  let messageId: string | null = null;
  let text = '';
  let finalStart: number | null = null;
  let inFinal = false;
  const agentTexts = new Map<string, string>();
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
    noteAgent(output) {
      if (!output.messageId) return;
      const raw = output.newMessage ? output.delta.slice(MESSAGE_SEPARATOR.length) : output.delta;
      agentTexts.set(output.messageId, (agentTexts.get(output.messageId) ?? '') + raw);
    },
    text: () => text,
    result: () => ({
      text,
      messageId,
      finalReply: finalReply(),
      agentMessages: [...agentTexts].map(([id, said]) => ({ id, fingerprint: fingerprint(said) })),
    }),
  };
}

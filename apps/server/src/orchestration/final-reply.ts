import type { TurnResult } from '../workflow/agent-turn.ts';
import type { MemberResult, Session } from './session.ts';

interface WrittenMessage {
  text: string;
  finalReply?: string | null;
}

export function finalReplyOf(
  message: WrittenMessage | null,
  results: readonly MemberResult[],
  compose: (results: MemberResult[]) => string,
): string | null {
  const marked = results.some((result) => result.finalReply);
  if (!marked && !message?.finalReply) return null;
  const lead = message?.finalReply ?? message?.text ?? '';
  const finals = results.map((result) =>
    result.finalReply ? { ...result, text: result.finalReply } : result,
  );
  return `${lead}${compose(finals)}`.trim() || null;
}

export function writtenMessage(turn: TurnResult): Session['message'] {
  if (!turn.messageId) return null;
  return { id: turn.messageId, text: turn.text, finalReply: turn.finalReply ?? null };
}

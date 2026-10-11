import type { ShipResult } from '@spark-outpost/contracts';
import { newId } from '../persistence/ids.ts';
import type { Published } from '../ship/published.ts';
import type { Append, TurnResult } from './agent-turn.ts';
import { runEvents } from './run-events.ts';

export function followUpLine(published: Published): string {
  const pull = published.pull ? ` to pull request #${published.pull.number}` : '';
  return published.pushed ? `Pushed the fix${pull}.` : 'The fix was not pushed.';
}

export function pushedLine(published: Published, branch: string): string {
  return published.pushed
    ? `Pushed ${branch}. No pull request was asked for.`
    : `${branch} was not pushed.`;
}

export function notPublishedLine(said: Pick<TurnResult, 'outcome' | 'error'>): string {
  if (said.outcome === 'cancelled') return 'Not published: the publish step was stopped.';
  const why = said.error ? ` ${said.error}` : '';
  return `Not published: the publish step failed.${why}`;
}

export function committedLine(result: ShipResult, why: string | null): string {
  const commit = result.commit ? ` ${result.commit.slice(0, 7)}` : '';
  return `Committed${commit} on ${result.branch}, not pushed.${why ? ` ${why}` : ''}`;
}

export function notCommittedLine(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `The change is kept but was not committed: ${reason}`;
}

export async function withLine(
  append: Append,
  reply: TurnResult,
  line: string | null,
): Promise<TurnResult> {
  if (!line) return reply;
  const messageId = reply.messageId ?? newId();
  if (!reply.messageId) await append(runEvents.textStart(messageId));
  const delta = reply.text.trim() ? `\n\n${line}` : line;
  await append(runEvents.textContent(messageId, delta));
  const text = reply.text + delta;
  if (!reply.finalReply) return { ...reply, messageId, text };
  return { ...reply, messageId, text, finalReply: `${reply.finalReply}\n\n${line}` };
}

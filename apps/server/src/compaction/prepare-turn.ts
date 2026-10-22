import { STOPPED_BY_QUIT } from '@spark-outpost/contracts';
import { newId } from '../persistence/ids.ts';
import type { Lease } from '../persistence/jobs.ts';
import { LeaseLostError } from '../persistence/run-events.ts';
import type { Append, RunControl } from '../workflow/agent-turn.ts';
import { closeMessage } from '../workflow/execute-run.ts';
import { runEvents } from '../workflow/run-events.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { compactBeforeTurn, type BeforeTurn, type BeforeTurnDeps } from './before-turn.ts';
import type { FreshChat } from './fresh-chat.ts';

export function movedReply(chat: FreshChat): string {
  return `This chat was almost full, so I started a fresh chat with a summary of it and your message: **${chat.title}**. The full transcript stays here.`;
}

async function finishMoved(append: Append, input: RunInput, chat: FreshChat): Promise<void> {
  const messageId = newId();
  const text = movedReply(chat);
  await append(runEvents.textStart(messageId));
  await append(runEvents.textContent(messageId, text));
  await closeMessage(append, { messageId, text }, true);
  await append(runEvents.finished(input.identity), { transition: { status: 'succeeded' } });
}

async function settle(
  deps: BeforeTurnDeps,
  lease: Lease,
  input: RunInput,
  append: Append,
  control: Pick<RunControl, 'signal' | 'stop' | 'reason'>,
): Promise<BeforeTurn> {
  try {
    return await compactBeforeTurn(deps, lease, input, append, control);
  } catch (error) {
    if (error instanceof LeaseLostError) throw error;
    if (control.signal.aborted) return { kind: 'stopped' };
    console.error('Could not compact the chat before the turn', error);
    return { kind: 'continue', input };
  }
}

export async function prepareTurn(
  deps: BeforeTurnDeps,
  lease: Lease,
  input: RunInput,
  append: Append,
  control: Pick<RunControl, 'signal' | 'stop' | 'reason'>,
): Promise<RunInput | null> {
  const before = await settle(deps, lease, input, append, control);
  if (before.kind === 'continue') return before.input;
  if (before.kind === 'moved') {
    await finishMoved(append, input, before.chat);
    return null;
  }
  const error = control.reason() === 'quit' ? { error: STOPPED_BY_QUIT } : {};
  await append(runEvents.cancelled(input.identity), {
    transition: { status: 'cancelled', ...error },
  });
  return null;
}

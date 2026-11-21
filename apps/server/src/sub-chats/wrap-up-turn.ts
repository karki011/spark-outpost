import type { Lease } from '../persistence/jobs.ts';
import {
  runAgentTurn,
  type Append,
  type RunControl,
  type TurnDeps,
} from '../workflow/agent-turn.ts';
import { finishRun } from '../workflow/execute-run.ts';
import type { RunInput } from '../workflow/run-input.ts';

export function asWrapUpReply(input: RunInput): RunInput {
  return { ...input, mode: input.mode === 'do' ? 'ask' : input.mode, planning: false };
}

export async function replyToWrapUp(
  deps: TurnDeps,
  lease: Lease,
  input: RunInput,
  append: Append,
  control: Pick<RunControl, 'signal' | 'reason' | 'stop'>,
): Promise<void> {
  const reply = asWrapUpReply(input);
  if (reply.mode !== input.mode) {
    await deps.db.query('UPDATE runs SET mode = $2 WHERE id = $1', [lease.runId, reply.mode]);
  }
  const result = await runAgentTurn(deps, lease, reply, append, control);
  await finishRun(append, reply.identity, result, true);
}

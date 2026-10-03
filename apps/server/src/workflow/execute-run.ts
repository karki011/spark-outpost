import { isApprovalEvent } from '@spark-outpost/contracts';
import type { Lease } from '../persistence/jobs.ts';
import { LeaseLostError } from '../persistence/run-events.ts';
import type { IntakeRecorder } from '../advisor/intake-recorder.ts';
import {
  runAgentTurn,
  startControl,
  type Append,
  type TurnDeps,
  type TurnOptions,
  type TurnResult,
} from './agent-turn.ts';
import { loadRunInput } from './run-input.ts';
import { runAppender } from './run-appender.ts';
import { runEvents, type RunIdentity } from './run-events.ts';

export interface ExecuteRunDeps extends TurnDeps {
  intake?: IntakeRecorder;
}

function mirroringApprovals(own: Append, parent: Append): Append {
  return async (event, options) => {
    const seq = await own(event, options);
    if (isApprovalEvent(event)) await parent(event);
    return seq;
  };
}

export async function executeChildRun(
  deps: ExecuteRunDeps,
  lease: Lease,
  options: TurnOptions = {},
  parentAppend?: Append,
): Promise<TurnResult> {
  const input = await loadRunInput(deps.db, lease.runId);
  const own = runAppender(deps.db, lease);
  const append = parentAppend ? mirroringApprovals(own, parentAppend) : own;
  const control = startControl(deps, lease, options.stopNow);
  try {
    await append(runEvents.started(input.identity), { transition: { status: 'running' } });
    const result = await runAgentTurn(deps, lease, input, append, control, options);
    await finishRun(append, input.identity, result, false);
    return result;
  } catch (error) {
    if (error instanceof LeaseLostError) {
      return { outcome: 'lease_lost', error: null, text: '', messageId: null };
    }
    throw error;
  } finally {
    control.dispose();
  }
}

export async function closeMessage(
  append: Append,
  result: Pick<TurnResult, 'messageId' | 'text'>,
  record: boolean,
): Promise<void> {
  if (!result.messageId) return;
  await append(
    runEvents.textEnd(result.messageId),
    record ? { assistantMessage: { id: result.messageId, content: result.text } } : undefined,
  );
}

export async function finishRun(
  append: Append,
  identity: RunIdentity,
  result: TurnResult,
  recordMessage: boolean,
): Promise<void> {
  if (result.outcome === 'lease_lost') return;
  try {
    await closeMessage(append, result, recordMessage);
    if (result.outcome === 'cancelled') {
      await append(runEvents.cancelled(identity), { transition: { status: 'cancelled' } });
    } else if (result.outcome === 'failed') {
      const message = result.error ?? 'The run failed.';
      await append(runEvents.error(message, 'provider_error'), {
        transition: { status: 'failed', error: message },
      });
    } else {
      await append(runEvents.finished(identity), { transition: { status: 'succeeded' } });
    }
  } catch (error) {
    if (!(error instanceof LeaseLostError)) throw error;
  }
}

export async function failSafely(append: Append, error: unknown): Promise<void> {
  console.error('Orchestration failed', error);
  const message =
    'The orchestration stopped with an unexpected error. Nothing after the last completed step was changed.';
  try {
    await append(runEvents.error(message, 'orchestration_failed'), {
      transition: { status: 'failed', error: message },
    });
  } catch (appendError) {
    if (!(appendError instanceof LeaseLostError)) throw appendError;
  }
}

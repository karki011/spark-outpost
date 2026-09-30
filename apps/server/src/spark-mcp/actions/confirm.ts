import { randomUUID } from 'node:crypto';
import {
  SPARK_ACTION_KIND,
  SPARK_ACTION_OPTION,
  applySparkEdits,
  sparkActionLabels,
  type Approval,
  type SparkAction,
} from '@spark-outpost/contracts';
import { redactValue } from '../../audit/redact.ts';
import { insertApproval, settlePending } from '../../persistence/approvals.ts';
import { LeaseLostError } from '../../persistence/run-events.ts';
import { waitForApproval } from '../../workflow/approval-waiters.ts';
import { runEvents } from '../../workflow/run-events.ts';
import type { SparkActionHooks, SparkScope, SparkToolDeps } from '../deps.ts';
import { SparkToolError, type SparkToolContext } from '../tool.ts';

type Confirmation =
  | { outcome: 'confirmed'; action: SparkAction }
  | { outcome: 'declined'; note: string | null }
  | { outcome: 'stopped' | 'timeout' };

interface ActionRun {
  runId: string;
  hooks: SparkActionHooks;
}

function actionRun(scope: SparkScope): ActionRun {
  if (!scope.runId || !scope.actions) {
    throw new SparkToolError(
      'This session cannot ask the user to confirm, so Spark cannot take actions here.',
    );
  }
  return { runId: scope.runId, hooks: scope.actions };
}

async function quietly(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch (error) {
    if (!(error instanceof LeaseLostError)) throw error;
  }
}

function cardTitle(action: SparkAction): string {
  const question = sparkActionLabels[action.action].question;
  if (action.action === 'create_ticket') return `${question} ${action.title}`;
  if (action.action === 'open_pr') return `${question} ${action.title}`;
  return `${question} ${action.ticket.key}`;
}

async function askToConfirm(
  deps: SparkToolDeps,
  run: ActionRun,
  action: SparkAction,
  caller: AbortSignal | undefined,
): Promise<Confirmation> {
  const { hooks } = run;
  const signal = caller ? AbortSignal.any([hooks.signal, caller]) : hooks.signal;
  const pending = await insertApproval(deps.db, {
    runId: run.runId,
    toolCallId: `spark:${action.action}:${randomUUID()}`,
    rpcId: null,
    kind: SPARK_ACTION_KIND,
    title: cardTitle(action),
    payload: {
      command: null,
      cwd: null,
      paths: [],
      diffs: [],
      truncated: false,
      sparkAction: action,
    },
    options: [
      {
        optionId: SPARK_ACTION_OPTION.confirm,
        name: sparkActionLabels[action.action].confirm,
        kind: 'allow_once',
      },
      { optionId: SPARK_ACTION_OPTION.decline, name: 'Don’t', kind: 'reject_once' },
    ],
    reason: null,
  });
  await hooks.append(runEvents.approvalRequested(pending), {
    transition: { status: 'awaiting_approval' },
  });
  const result = await waitForApproval(pending.id, {
    db: deps.db,
    waiters: hooks.waiters,
    signal,
    timeoutMs: hooks.timeoutMs,
    pollMs: hooks.pollMs,
  });
  if (result === 'aborted' || result === 'timeout') {
    const settled = await settlePending(deps.db, pending.id, {
      status: result === 'aborted' ? 'cancelled' : 'expired',
      decidedBy: result === 'aborted' ? 'stop' : 'timeout',
      optionId: null,
    });
    if (settled) await quietly(hooks.append(runEvents.approvalDecided(settled)));
    return { outcome: result === 'aborted' ? 'stopped' : 'timeout' };
  }
  await quietly(
    hooks.append(runEvents.approvalDecided(result), { transition: { status: 'running' } }),
  );
  return decisionOf(result, action);
}

function decisionOf(approval: Approval, action: SparkAction): Confirmation {
  if (approval.status === 'allowed') {
    return { outcome: 'confirmed', action: applySparkEdits(action, approval.edits ?? null) };
  }
  if (approval.status === 'denied') return { outcome: 'declined', note: approval.note ?? null };
  return { outcome: 'stopped' };
}

function auditAction(run: ActionRun, action: SparkAction, outcome: Record<string, unknown>): void {
  run.hooks.audit?.message('harness', {
    method: `spark/${action.action}`,
    params: redactValue({ action, ...outcome }),
  });
}

function unconfirmed(confirmation: Exclude<Confirmation, { outcome: 'confirmed' }>) {
  if (confirmation.outcome === 'declined') {
    return {
      outcome: 'declined',
      message: 'The user declined. Nothing was changed.',
      ...(confirmation.note ? { userNote: confirmation.note } : {}),
    };
  }
  return {
    outcome: confirmation.outcome,
    message:
      confirmation.outcome === 'timeout'
        ? 'Nobody answered the confirmation card in time. Nothing was changed.'
        : 'The request was stopped before the user answered. Nothing was changed.',
  };
}

export async function confirmThen<T extends object>(
  context: SparkToolContext,
  action: SparkAction,
  perform: (confirmed: SparkAction) => Promise<T>,
) {
  const run = actionRun(context.scope);
  const answer = await askToConfirm(context.deps, run, action, context.signal);
  if (answer.outcome !== 'confirmed') {
    auditAction(run, action, { outcome: answer.outcome });
    return unconfirmed(answer);
  }
  try {
    const result = await perform(answer.action);
    auditAction(run, answer.action, { outcome: 'done', result });
    return { outcome: 'done', ...result };
  } catch (error) {
    auditAction(run, answer.action, { outcome: 'failed', error: (error as Error).message });
    throw new SparkToolError(`The user confirmed, but it failed: ${(error as Error).message}`);
  }
}

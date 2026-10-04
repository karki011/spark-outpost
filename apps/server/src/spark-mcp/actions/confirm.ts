import { randomUUID } from 'node:crypto';
import {
  SPARK_ACTION_KIND,
  SPARK_ACTION_OPTION,
  sparkActionLabels,
  sparkResultFinished,
  type Approval,
  type SparkAction,
} from '@spark-outpost/contracts';
import { redactValue } from '../../audit/redact.ts';
import { getApproval, insertApproval, notifyApprovalChanged } from '../../persistence/approvals.ts';
import type { Queryable } from '../../persistence/db.ts';
import { LeaseLostError } from '../../persistence/run-events.ts';
import { WAITING_RESULT } from '../../persistence/spark-results.ts';
import { runEvents } from '../../workflow/run-events.ts';
import type { SparkActionHooks, SparkScope } from '../deps.ts';
import { SparkToolError, type SparkToolContext } from '../tool.ts';
import { actionFacts, actionPath, type ActionPath } from './action-policy.ts';

export const RESULT_WAIT_MS = 40_000;

export const WAITING_MESSAGE =
  'Spark showed the user a confirm card in the chat and will do it as soon as they confirm; the result appears on that card. Do not call this again and do not ask the user to do it by hand. Tell them it is waiting for their confirmation.';

export const IN_PROGRESS_MESSAGE =
  'Spark is still doing it; the result appears on the card in the chat. Do not call this again.';

interface ActionRun {
  runId: string;
  hooks: SparkActionHooks;
  scope: SparkScope;
}

function actionRun(scope: SparkScope): ActionRun {
  if (!scope.runId || !scope.actions) {
    throw new SparkToolError(
      'This session cannot ask the user to confirm, so Spark cannot take actions here.',
    );
  }
  return { runId: scope.runId, hooks: scope.actions, scope };
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
  if (action.action === 'post_slack') return `${question} #${action.channel.name}`;
  if ('name' in action) return `${question} ${action.name}`;
  if (action.action === 'pr_follow_up' || action.action === 'pr_follow_up_round') {
    return `${question} ${action.repo}#${action.number}`;
  }
  return `${question} ${action.ticket.key}`;
}

interface CardPlan {
  path: ActionPath;
  requested: boolean;
  observed: readonly string[];
}

async function postCard(
  db: Queryable,
  run: ActionRun,
  action: SparkAction,
  { path, requested, observed }: CardPlan,
): Promise<Approval> {
  const card = await insertApproval(
    db,
    {
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
        sparkResult: WAITING_RESULT,
        ...(requested ? { sparkRequested: true } : {}),
        ...(observed.length > 0 ? { observed: [...observed] } : {}),
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
    },
    path === 'perform'
      ? { status: 'allowed', decidedBy: 'level', optionId: SPARK_ACTION_OPTION.confirm }
      : null,
  );
  await quietly(run.hooks.append(runEvents.approvalRequested(card)));
  if (path === 'perform') await quietly(run.hooks.append(runEvents.approvalDecided(card)));
  await notifyApprovalChanged(db, card.id);
  return card;
}

function auditAction(run: ActionRun, action: SparkAction, outcome: Record<string, unknown>): void {
  run.hooks.audit?.message('harness', {
    method: `spark/${action.action}`,
    params: redactValue({ action, ...outcome }),
  });
}

async function awaitResult(
  context: SparkToolContext,
  run: ActionRun,
  id: string,
): Promise<Approval | null> {
  const signal = context.signal
    ? AbortSignal.any([run.hooks.signal, context.signal])
    : run.hooks.signal;
  const deadline = Date.now() + RESULT_WAIT_MS;
  for (;;) {
    const current = await getApproval(context.deps.db, id);
    if (!current || sparkResultFinished(current.payload.sparkResult)) return current;
    const remaining = deadline - Date.now();
    if (signal.aborted || remaining <= 0) return null;
    await run.hooks.waiters.wait(id, Math.min(run.hooks.pollMs, remaining), signal);
  }
}

function finished(approval: Approval) {
  const result = approval.payload.sparkResult!;
  if (result.state === 'failed') {
    throw new SparkToolError(`Spark could not do it: ${result.message ?? 'it failed.'}`);
  }
  return { outcome: 'done', message: result.message, url: result.url, ...result.output };
}

export async function proposeAction(context: SparkToolContext, action: SparkAction) {
  const run = actionRun(context.scope);
  const observed = (await run.scope.observations?.labels()) ?? [];
  const facts = await actionFacts(
    context.deps.db,
    { runId: run.runId, conversationId: run.scope.conversationId, observed: observed.length > 0 },
    action.action,
  );
  const path = actionPath(facts);
  const card = await postCard(context.deps.db, run, action, {
    path,
    requested: facts.requested,
    observed,
  });
  if (path === 'confirm') {
    auditAction(run, action, { outcome: 'waiting_for_user', approvalId: card.id });
    return { outcome: 'waiting_for_user', approvalId: card.id, message: WAITING_MESSAGE };
  }
  auditAction(run, action, { outcome: 'performing', approvalId: card.id });
  const settled = await awaitResult(context, run, card.id);
  if (!settled)
    return { outcome: 'in_progress', approvalId: card.id, message: IN_PROGRESS_MESSAGE };
  return finished(settled);
}

import { randomUUID } from 'node:crypto';
import {
  SPARK_ACTION_KIND,
  atlassianAuditFacts,
  atlassianCardSubject,
  calendarAuditFacts,
  isAtlassianAction,
  isCalendarAction,
  SPARK_ACTION_OPTION,
  sparkActionLabels,
  sparkActionQuestion,
  sparkResultFinished,
  type Approval,
  type SparkAction,
} from '@spark-outpost/contracts';
import { redactValue } from '../../audit/redact.ts';
import { getApproval, insertApproval, notifyApprovalChanged } from '../../persistence/approvals.ts';
import type { Queryable } from '../../persistence/db.ts';
import { LeaseLostError } from '../../persistence/run-events.ts';
import { lastFailedAttempt, WAITING_RESULT } from '../../persistence/spark-results.ts';
import { runEvents } from '../../workflow/run-events.ts';
import type { SparkActionHooks, SparkScope } from '../deps.ts';
import { SparkToolError, type SparkToolContext } from '../tool.ts';
import { actionFacts, actionPath, type ActionPath } from './action-policy.ts';
import { assistantPath, assistantRefusal } from './ask-spark-limits.ts';

export const ASK_SPARK_ACTOR = 'Ask Spark';

export const RESULT_WAIT_MS = 40_000;

export const WAITING_MESSAGE =
  'Spark showed the user a confirm card in the chat and will do it as soon as they confirm; the result appears on that card. Do not call this again and do not ask the user to do it by hand. Tell them it is waiting for their confirmation.';

const LAST_ATTEMPT_FAILED =
  'The last time the user confirmed this it failed, and nothing has retried it. Tell the user why, and fix the cause if it is yours, before relying on this card:';

export const IN_PROGRESS_MESSAGE =
  'Spark is still doing it; the result appears on the card in the chat. Do not call this again.';

const SENDS_TO: Partial<Record<SparkAction['action'], string>> = {
  create_ticket: 'to your ticket tracker',
  comment_ticket: 'to your ticket tracker',
  transition_ticket: 'to your ticket tracker',
  assign_ticket: 'to your ticket tracker',
  post_slack: 'to Slack',
  jira_edit: 'to Jira',
  confluence_edit: 'to Confluence',
};

export interface ActionRun {
  runId: string;
  hooks: SparkActionHooks;
  scope: SparkScope;
}

export function actionRun(scope: SparkScope): ActionRun {
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
  if (action.action === 'ask_spark') return action.summary;
  const question = sparkActionQuestion(action);
  if (
    action.action === 'browser_sign_in' ||
    action.action === 'browser_handoff' ||
    action.action === 'mac_use_app' ||
    action.action === 'mac_act' ||
    action.action === 'mac_press'
  ) {
    return question;
  }
  if (action.action === 'calendar_read' || action.action === 'atlassian_read') return question;
  if (action.action === 'jira_edit' || action.action === 'confluence_edit') {
    return `${question} ${atlassianCardSubject(action)}`;
  }
  if (action.action === 'calendar_edit') {
    return `${question} ${action.after?.title ?? action.before?.title ?? ''}`.trim();
  }
  if (action.action === 'create_ticket') return `${question} ${action.title}`;
  if (action.action === 'start_outpost') return `${question} ${action.outpostName}`;
  if (action.action === 'open_pr') return `${question} ${action.title}`;
  if (action.action === 'post_slack') return `${question} #${action.channel.name}`;
  if ('name' in action) return `${question} ${action.name}`;
  if (
    action.action === 'read_page' ||
    action.action === 'open_page' ||
    action.action === 'act_page'
  ) {
    return `${question} ${action.origin}${action.path}`;
  }
  if (action.action === 'pr_follow_up' || action.action === 'pr_follow_up_round') {
    return `${question} ${action.repo}#${action.number}`;
  }
  if (action.action === 'transition_ticket' && action.to) {
    return `${question} ${action.ticket.key} → ${action.to}`;
  }
  return `${question} ${action.ticket.key}`;
}

export interface CardPlan {
  path: ActionPath;
  requested: boolean;
  observed: readonly string[];
  secretSend?: readonly string[];
  confirmName?: string;
  declineName?: string;
}

export async function postCard(
  db: Queryable,
  run: ActionRun,
  action: SparkAction,
  { path, requested, observed, secretSend, confirmName, declineName }: CardPlan,
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
        ...(secretSend && secretSend.length > 0 ? { secretSend: [...secretSend] } : {}),
      },
      options: [
        {
          optionId: SPARK_ACTION_OPTION.confirm,
          name: confirmName ?? sparkActionLabels[action.action].confirm,
          kind: 'allow_once',
        },
        {
          optionId: SPARK_ACTION_OPTION.decline,
          name: declineName ?? 'Don’t',
          kind: 'reject_once',
        },
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

export function auditedAction(action: SparkAction): unknown {
  if (action.action === 'calendar_read' || action.action === 'calendar_edit') {
    return calendarAuditFacts(action);
  }
  if (
    action.action === 'atlassian_read' ||
    action.action === 'jira_edit' ||
    action.action === 'confluence_edit'
  ) {
    return atlassianAuditFacts(action);
  }
  return action;
}

export function auditAction(
  run: ActionRun,
  action: SparkAction,
  outcome: Record<string, unknown>,
): void {
  run.hooks.audit?.message('harness', {
    method: `spark/${action.action}`,
    params: redactValue({
      action: auditedAction(action),
      ...(run.scope.assistant ? { by: ASK_SPARK_ACTOR } : {}),
      ...outcome,
    }),
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

export interface ProposeOptions {
  alwaysAsk?: boolean;
  sendsTo?: string | null;
  sendSubject?: string;
  confirmName?: string;
  declineName?: string;
}

export async function proposeAction(
  context: SparkToolContext,
  action: SparkAction,
  options: ProposeOptions = {},
) {
  const run = actionRun(context.scope);
  const assistant = run.scope.assistant === true;
  if (assistant) {
    const refusal = await assistantRefusal(
      context.deps.db,
      run.scope.workspaceId,
      run.runId,
      action,
    );
    if (refusal) {
      auditAction(run, action, { outcome: 'refused', reason: refusal });
      throw new SparkToolError(refusal);
    }
  }
  const observed = (await run.scope.observations?.labels()) ?? [];
  const facts = await actionFacts(context.deps.db, run.runId, action.action);
  const path = options.alwaysAsk
    ? 'confirm'
    : assistant
      ? await assistantPath(context.deps.db, run.scope.workspaceId, run.runId, action)
      : actionPath(facts);
  const failedBefore = await lastFailedAttempt(
    context.deps.db,
    run.scope.conversationId,
    action.action,
  );
  const card = await postCard(context.deps.db, run, action, {
    path,
    requested: facts.requested,
    observed,
    ...(options.confirmName ? { confirmName: options.confirmName } : {}),
    ...(options.declineName ? { declineName: options.declineName } : {}),
  });
  if (path === 'confirm') {
    auditAction(run, action, { outcome: 'waiting_for_user', approvalId: card.id });
    return {
      outcome: 'waiting_for_user',
      approvalId: card.id,
      message: WAITING_MESSAGE,
      ...(failedBefore ? { lastAttempt: `${LAST_ATTEMPT_FAILED} ${failedBefore}` } : {}),
    };
  }
  auditAction(run, action, {
    outcome: 'performing',
    approvalId: card.id,
    ...(isCalendarAction(action.action) || isAtlassianAction(action.action)
      ? { ranWithoutReview: true }
      : {}),
  });
  const target = options.sendsTo === undefined ? SENDS_TO[action.action] : options.sendsTo;
  if (target && observed.length > 0) {
    run.scope.observations?.sentOut({
      toolCallId: null,
      subject: options.sendSubject ?? card.title,
      target,
      observed,
      approvalId: card.id,
    });
  }
  const settled = await awaitResult(context, run, card.id);
  if (!settled)
    return { outcome: 'in_progress', approvalId: card.id, message: IN_PROGRESS_MESSAGE };
  return finished(settled);
}

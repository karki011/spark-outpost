import {
  CHECKPOINT_OPTION,
  isCheckpointKind,
  type AgentPick,
  type Approval,
  type BudgetLimit,
  type CheckpointPayload,
} from '@spark-outpost/contracts';
import { formatDuration } from '../../audit/audit-model.ts';
import { formatCost } from '../../usage/format.ts';
import { shortLabel } from '../composer/model-options.ts';

export interface CheckpointApproval extends Approval {
  payload: Approval['payload'] & { checkpoint: CheckpointPayload };
}

export function isCheckpoint(approval: Approval): approval is CheckpointApproval {
  return isCheckpointKind(approval.kind) && approval.payload.checkpoint !== undefined;
}

export function offers(approval: Approval, optionId: string): boolean {
  return approval.options.some((option) => option.optionId === optionId);
}

export function optionName(approval: Approval, optionId: string): string | null {
  return approval.options.find((option) => option.optionId === optionId)?.name ?? null;
}

const TITLES: Record<CheckpointPayload['kind'], string> = {
  clarify: 'Jev has a question',
  plan: 'Approve the plan?',
  retry: 'A step needs another try',
  accept: 'Keep these changes?',
  budget: 'Continue past the budget?',
  merge_conflict: 'The Builder’s copy and your files collided',
  stuck: 'The Builder was repeating itself',
  verify: 'Jev could not verify the change',
};

export function checkpointTitle(payload: CheckpointPayload): string {
  if (payload.kind === 'stuck')
    return payload.agent ? `${payload.agent} was repeating itself` : TITLES.stuck;
  if (payload.agent) return `${payload.agent} needs your input`;
  return TITLES[payload.kind];
}

export function checkpointQuestion(payload: CheckpointPayload): string | null {
  return payload.question === checkpointTitle(payload) ? null : payload.question;
}

const WAITING_LABELS: Record<CheckpointPayload['kind'], string> = {
  clarify: 'Answer Jev’s question',
  plan: 'Approve the plan',
  retry: 'Retry, or stop and report',
  accept: 'Keep, fix, or revert the changes',
  budget: 'Continue past the budget',
  merge_conflict: 'Choose which version to keep',
  stuck: 'Continue, or stop and report',
  verify: 'Finish, retry one tier up, or stop',
};

export function waitingLabel(payload: CheckpointPayload): string {
  if (payload.kind === 'stuck') {
    return payload.agent ? `Continue ${payload.agent}, or stop` : WAITING_LABELS.stuck;
  }
  if (payload.agent) return `Answer ${payload.agent}`;
  return WAITING_LABELS[payload.kind];
}

export function pickLabel(pick: AgentPick | null): string | null {
  if (!pick) return null;
  const model = pick.modelLabel ? shortLabel(pick.modelLabel) : pick.model;
  return [model, pick.effort].filter(Boolean).join(' · ') || null;
}

export function retryLine(payload: CheckpointPayload): string {
  const to = pickLabel(payload.to);
  const from = pickLabel(payload.from);
  if (!to || to === from) return 'Retry the step once more?';
  return `Retry with ${to}?`;
}

export function escalateLabel(payload: CheckpointPayload): string {
  const to = pickLabel(payload.to);
  return to && to !== pickLabel(payload.from) ? `Retry with ${to}` : 'Retry one tier up';
}

function budgetAmount(limit: BudgetLimit, value: number): string {
  if (limit === 'time') return formatDuration(value);
  if (limit === 'cost') return formatCost(value);
  return `${value} tool ${value === 1 ? 'call' : 'calls'}`;
}

const BUDGET_NAMES: Record<BudgetLimit, string> = {
  time: 'active time',
  tool_calls: 'tool calls',
  cost: 'the cost cap',
};

export function budgetLine(payload: CheckpointPayload): string | null {
  const budget = payload.budget;
  if (!budget) return null;
  const used = budgetAmount(budget.limit, budget.used);
  const allowed = budgetAmount(budget.limit, budget.allowed);
  return `Used ${used} of ${allowed} · ${BUDGET_NAMES[budget.limit]}`;
}

const RESULTS: Record<string, string> = {
  [CHECKPOINT_OPTION.stop]: 'Stopped.',
  [CHECKPOINT_OPTION.clarifyRules]: 'Left it to the fixed rules.',
  [CHECKPOINT_OPTION.approvePlan]: 'Plan approved.',
  [CHECKPOINT_OPTION.editPlan]: 'Sent your changes to the plan.',
  [CHECKPOINT_OPTION.retry]: 'Retrying.',
  [CHECKPOINT_OPTION.finish]: 'Skipped.',
  [CHECKPOINT_OPTION.keep]: 'Kept the changes.',
  [CHECKPOINT_OPTION.fix]: 'Asked for a fix.',
  [CHECKPOINT_OPTION.fixFindings]: 'Sent the review findings back to the Builder.',
  [CHECKPOINT_OPTION.revert]: 'Reverted the changes.',
  [CHECKPOINT_OPTION.continueBudget]: 'Continued past the budget.',
  [CHECKPOINT_OPTION.answer]: 'Answered.',
  [CHECKPOINT_OPTION.reconcile]: 'Asked a Builder to reconcile.',
  [CHECKPOINT_OPTION.nudge]: 'Nudged it; the note goes with its next turn.',
  [CHECKPOINT_OPTION.letContinue]: 'Let it continue.',
  [CHECKPOINT_OPTION.continueStuck]: 'Continued with a note to try another way.',
  [CHECKPOINT_OPTION.stopReport]: 'Stopped and reported.',
  [CHECKPOINT_OPTION.justAnswer]: 'Answered without changes.',
  [CHECKPOINT_OPTION.makeChange]: 'Making the change.',
  [CHECKPOINT_OPTION.finishUnverified]: 'Finished without verification.',
};

const AUTO_LABELS: Record<string, string> = {
  [CHECKPOINT_OPTION.finish]: 'Skip',
  [CHECKPOINT_OPTION.clarifyRules]: 'Continue',
  [CHECKPOINT_OPTION.letContinue]: 'Let it continue',
  [CHECKPOINT_OPTION.stopReport]: 'Stop and report',
  [CHECKPOINT_OPTION.finishUnverified]: 'Finish',
};

export function autoLabel(optionId: string, seconds: number): string {
  return `${AUTO_LABELS[optionId] ?? 'Continue'} (${seconds}s)`;
}

export function secondsLeft(autoContinueAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(autoContinueAt) - now) / 1000));
}

export function autoDelaySeconds(approval: Approval): number | null {
  if (!approval.autoContinueAt) return null;
  return Math.round((Date.parse(approval.autoContinueAt) - Date.parse(approval.createdAt)) / 1000);
}

export function checkpointResult(approval: Approval): string {
  if (approval.status === 'expired') return 'Expired before you answered.';
  if (approval.decidedBy === 'auto') {
    const delay = autoDelaySeconds(approval);
    return delay === null ? 'Continued automatically.' : `Continued automatically after ${delay}s.`;
  }
  if (approval.status === 'cancelled' && approval.decidedBy === 'policy') {
    return 'It moved on before you answered.';
  }
  if (approval.status === 'cancelled') return 'The run stopped before you answered.';
  const id = approval.decisionOptionId;
  if (!id) return approval.status === 'denied' ? 'Stopped.' : 'Answered.';
  const conflict = approval.payload.checkpoint?.conflict;
  if (conflict && id === CHECKPOINT_OPTION.keepFirst) {
    return conflict.first === 'your version'
      ? 'Kept your version.'
      : `Kept ${conflict.first}’s change.`;
  }
  if (conflict && id === CHECKPOINT_OPTION.keepSecond) return `Kept ${conflict.second}’s change.`;
  const choices = approval.payload.checkpoint?.choices ?? [];
  const index = id.startsWith('option:') ? Number(id.slice('option:'.length)) : -1;
  if (index >= 0 && choices[index]) return `You chose: ${choices[index]}`;
  return RESULTS[id] ?? 'Answered.';
}

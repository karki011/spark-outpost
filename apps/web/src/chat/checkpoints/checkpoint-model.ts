import {
  CHECKPOINT_OPTION,
  isCheckpointKind,
  type AgentPick,
  type Approval,
  type BudgetLimit,
  type CheckpointPayload,
  type PlanEntry,
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

const TITLES: Record<CheckpointPayload['kind'], string> = {
  clarify: 'Jev has a question',
  plan: 'Approve the plan?',
  retry: 'A step needs another try',
  accept: 'Keep these changes?',
  budget: 'Continue past the budget?',
  merge_conflict: 'Parallel changes collided',
};

export function checkpointTitle(payload: CheckpointPayload): string {
  if (payload.agent) return `${payload.agent} needs your input`;
  return TITLES[payload.kind];
}

const WAITING_LABELS: Record<CheckpointPayload['kind'], string> = {
  clarify: 'Answer Jev’s question',
  plan: 'Approve the plan',
  retry: 'Retry or skip a step',
  accept: 'Keep, fix, or revert the changes',
  budget: 'Continue past the budget',
  merge_conflict: 'Choose which parallel change to keep',
};

export function waitingLabel(payload: CheckpointPayload): string {
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
  if (!to || to === from) return 'Jev suggests retrying the step.';
  return `Jev suggests retrying with ${to}.`;
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

export function planText(entries: readonly PlanEntry[]): string {
  return entries.map((entry) => `- ${entry.content}`).join('\n');
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
  [CHECKPOINT_OPTION.revert]: 'Reverted the changes.',
  [CHECKPOINT_OPTION.continueBudget]: 'Continued past the budget.',
  [CHECKPOINT_OPTION.answer]: 'Answered.',
  [CHECKPOINT_OPTION.reconcile]: 'Asked a Builder to reconcile.',
};

const AUTO_LABELS: Record<string, string> = {
  [CHECKPOINT_OPTION.finish]: 'Skip',
  [CHECKPOINT_OPTION.clarifyRules]: 'Continue',
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
  if (approval.status === 'cancelled') return 'The run stopped before you answered.';
  const id = approval.decisionOptionId;
  if (!id) return approval.status === 'denied' ? 'Stopped.' : 'Answered.';
  const conflict = approval.payload.checkpoint?.conflict;
  if (conflict && id === CHECKPOINT_OPTION.keepFirst) return `Kept ${conflict.first}’s change.`;
  if (conflict && id === CHECKPOINT_OPTION.keepSecond) return `Kept ${conflict.second}’s change.`;
  const choices = approval.payload.checkpoint?.choices ?? [];
  const index = id.startsWith('option:') ? Number(id.slice('option:'.length)) : -1;
  if (index >= 0 && choices[index]) return `You chose: ${choices[index]}`;
  return RESULTS[id] ?? 'Answered.';
}

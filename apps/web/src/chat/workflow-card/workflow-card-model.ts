import {
  findingsIn,
  isTerminalRunStatus,
  type Approval,
  type ConversationDetail,
  type CrewMember,
  type Finding,
  type FindingSeverity,
  type Run,
  type WorkflowRun,
} from '@spark-outpost/contracts';
import { sparkMembers } from '../../crew/conversation-crew.ts';

export const WORKFLOW_DISMISSED = 'spark-outpost.workflow-card.dismissed';
export const CARD_TURNS_MAX = 5;
export const FIX_NOTE = 'Fix this.';

export const SEVERITY_WORDS: Record<FindingSeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const SEVERITY_ORDER: readonly FindingSeverity[] = ['critical', 'high', 'medium', 'low'];

export function stepMembers(detail: ConversationDetail, turnRunId: string): CrewMember[] {
  return sparkMembers(detail.orchestrations?.[turnRunId]).filter(
    (member) => member.spark?.step !== undefined,
  );
}

export function isWorkflowTurn(detail: ConversationDetail, run: Run): boolean {
  return run.workflowStarted === true || stepMembers(detail, run.id).length > 0;
}

export function workflowTurnIds(detail: ConversationDetail): string[] {
  return detail.runs.filter((run) => isWorkflowTurn(detail, run)).map((run) => run.id);
}

export function cardTurnIds(detail: ConversationDetail, dismissed: ReadonlySet<string>): string[] {
  return workflowTurnIds(detail)
    .filter((id) => !dismissed.has(id))
    .slice(-CARD_TURNS_MAX);
}

function sentByUser(run: Run): boolean {
  return run.workflowStarted !== true && run.prFollowUp !== true && run.agentCycle !== true;
}

export function userTurnAfter(detail: ConversationDetail, turnRunId: string): boolean {
  const index = detail.runs.findIndex((run) => run.id === turnRunId);
  return index >= 0 && detail.runs.slice(index + 1).some(sentByUser);
}

export function lastSteps(run: WorkflowRun): WorkflowRun['steps'] {
  const needed = new Set(run.steps.flatMap((step) => step.dependsOn));
  return run.steps.filter((step) => !needed.has(step.stepId));
}

export interface RunFinding extends Finding {
  stepId: string;
}

export function runFindings(run: WorkflowRun): RunFinding[] {
  const found = lastSteps(run).flatMap((step) =>
    findingsIn(step.note).map((finding) => ({ ...finding, stepId: step.stepId })),
  );
  return found.sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
}

export interface SeverityCount {
  severity: FindingSeverity;
  count: number;
}

export function severityCounts(findings: readonly Finding[]): SeverityCount[] {
  return SEVERITY_ORDER.map((severity) => ({
    severity,
    count: findings.filter((finding) => finding.severity === severity).length,
  })).filter((entry) => entry.count > 0);
}

export function isBlocking(severity: FindingSeverity): boolean {
  return severity === 'critical' || severity === 'high';
}

function troubled(run: WorkflowRun): boolean {
  return run.status === 'failed' || run.status === 'outcome_unknown';
}

export function stays(run: WorkflowRun, waiting: boolean): boolean {
  return (
    !isTerminalRunStatus(run.status) || waiting || troubled(run) || runFindings(run).length > 0
  );
}

export function shownOnCard(
  run: WorkflowRun,
  turnRunId: string,
  detail: ConversationDetail,
  waiting: boolean,
): boolean {
  return stays(run, waiting) || !userTurnAfter(detail, turnRunId);
}

export function pendingApprovals(
  approvals: readonly Approval[],
  members: readonly CrewMember[],
): Approval[] {
  const runIds = new Set(members.map((member) => member.runId));
  return approvals.filter(
    (approval) => approval.status === 'pending' && runIds.has(approval.runId),
  );
}

export function currentStep(run: WorkflowRun, members: readonly CrewMember[]): string | null {
  if (isTerminalRunStatus(run.status)) return null;
  const index = run.steps.findIndex((step) => step.state === 'running');
  if (index < 0) return null;
  const step = run.steps[index]!;
  const member = members.find((candidate) => candidate.runId === step.runId);
  const position = `step ${index + 1} of ${run.steps.length}`;
  return member ? `${position} · ${member.name}` : position;
}

export function findingQuote(finding: Finding): string {
  return `[${SEVERITY_WORDS[finding.severity]}] ${finding.text}`;
}

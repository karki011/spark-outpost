import {
  agentRoleLabel,
  agentRoleSchema,
  type Approval,
  type ConversationDetail,
  type Orchestration,
  type OrchestrationDecision,
} from '@spark-outpost/contracts';
import { isDispatcher, type CrewAgent } from './crew-model.ts';
import { JEV_ID } from './crew-projection.ts';

export interface TvAsk {
  approvalId: string;
  text: string;
}

export function roleTitle(agent: Pick<CrewAgent, 'role' | 'title'>): string {
  if (agent.title) return agent.title;
  if (isDispatcher(agent)) return 'Dispatcher';
  const role = agentRoleSchema.safeParse(agent.role);
  return role.success ? agentRoleLabel(role.data) : agent.role;
}

export function roleSubtitle(agent: Pick<CrewAgent, 'role' | 'name' | 'title'>): string | null {
  if (agent.title) return agent.title;
  const title = roleTitle(agent);
  return agent.name.startsWith(title) || isDispatcher(agent) ? null : title;
}

function baseName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function question(text: string): string {
  const trimmed = text.trim().replace(/[.?!]+$/, '');
  return `${lowerFirst(trimmed)}?`;
}

export function askText(approval: Approval): string {
  if (approval.kind === 'stuck') return `Needs you: ${approval.title}`;
  const command = approval.payload.command?.trim();
  if (command) return `Needs you: run ${command}?`;
  const path = approval.payload.paths[0];
  if (approval.kind === 'edit' && path) return `Needs you: change ${baseName(path)}?`;
  return `Needs you: ${question(approval.title)}`;
}

function ownedRuns(orchestration: Orchestration): Set<string> {
  return new Set([orchestration.runId, ...orchestration.crew.map((member) => member.runId)]);
}

export function pendingAsks(
  detail: ConversationDetail | undefined,
  orchestration: Orchestration,
  agents: readonly CrewAgent[],
): Record<string, TvAsk> {
  const runs = ownedRuns(orchestration);
  const pending = (detail?.approvals ?? []).filter(
    (approval) => approval.status === 'pending' && runs.has(approval.runId),
  );
  const checkpoint = orchestration.pendingCheckpoint;
  if (checkpoint && !pending.some((approval) => approval.id === checkpoint.id)) {
    pending.push(checkpoint);
  }
  const asks: Record<string, TvAsk> = {};
  for (const approval of pending) {
    const owner = agents.find((agent) => agent.id === approval.runId)?.id ?? JEV_ID;
    asks[owner] ??= { approvalId: approval.id, text: askText(approval) };
  }
  return asks;
}

function confidence(decision: OrchestrationDecision): string | null {
  return decision.gate ? decision.gate.confidence.toFixed(2) : null;
}

function decisionVerb(decision: OrchestrationDecision): string {
  if (decision.kind === 'intake') return 'Picked';
  if (decision.kind === 'verify') return 'Checked';
  if (decision.kind !== 'route') return 'Noted';
  const role = agentRoleSchema.safeParse(decision.role);
  return role.success ? `Sent ${agentRoleLabel(role.data)}` : 'Routed';
}

export function decisionLine(decision: OrchestrationDecision | undefined): string | null {
  if (!decision || !decision.summary) return null;
  const separator = decision.kind === 'intake' ? ' ' : ': ';
  const summary = `${decisionVerb(decision)}${separator}${decision.summary}`;
  return [summary, confidence(decision)].filter(Boolean).join(' · ');
}

const OBSERVED: ReadonlySet<string> = new Set(['policy']);

export function lastDecisionLine(orchestration: Orchestration): string | null {
  const shown = orchestration.decisions.filter((decision) => !OBSERVED.has(decision.kind));
  return decisionLine(shown.at(-1));
}

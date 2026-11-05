import {
  agentRoleLabel,
  agentRoleSchema,
  type Approval,
  type ConversationDetail,
} from '@spark-outpost/contracts';
import { CHAT_AGENT_ROLE, type CrewAgent } from './crew-model.ts';

export interface TvAsk {
  approvalId: string;
  text: string;
}

export function roleTitle(agent: Pick<CrewAgent, 'role'>): string {
  if (agent.role === CHAT_AGENT_ROLE) return 'Agent';
  const role = agentRoleSchema.safeParse(agent.role);
  return role.success ? agentRoleLabel(role.data) : agent.role;
}

export function roleSubtitle(agent: Pick<CrewAgent, 'role' | 'name' | 'spark'>): string | null {
  if (agent.role === CHAT_AGENT_ROLE) return null;
  if (agent.spark?.role) return agent.spark.role;
  const title = roleTitle(agent);
  return agent.name.startsWith(title) ? null : title;
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
  const command = approval.payload.command?.trim();
  if (command) return `Needs you: run ${command}?`;
  const path = approval.payload.paths[0];
  if (approval.kind === 'edit' && path) return `Needs you: change ${baseName(path)}?`;
  return `Needs you: ${question(approval.title)}`;
}

export function pendingAsks(
  detail: ConversationDetail | undefined,
  agents: readonly CrewAgent[],
): Record<string, TvAsk> {
  const owners = new Set(agents.map((agent) => agent.id));
  const asks: Record<string, TvAsk> = {};
  for (const approval of detail?.approvals ?? []) {
    if (approval.status !== 'pending' || !owners.has(approval.runId)) continue;
    asks[approval.runId] ??= { approvalId: approval.id, text: askText(approval) };
  }
  return asks;
}

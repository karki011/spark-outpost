import type { Approval } from '@spark-outpost/contracts';

const SANDBOX = /sandbox/i;

export function fromSandbox(reason: string): boolean {
  return SANDBOX.test(reason);
}

function agentReasonLine(agent: string, reason: string): string {
  if (fromSandbox(reason)) {
    return `${agent} couldn't run this inside its sandbox, so it asks before running it without one.`;
  }
  return `${agent} asks because: ${reason}`;
}

export function askerName(approval: Approval, agent: string): string {
  const subagent = approval.payload.subagent;
  return subagent ? `${agent}'s sub-agent ${subagent}` : agent;
}

export function askReason(approval: Approval, agent: string): string | null {
  const own = approval.payload.agentReason;
  if (!own) return null;
  const asker = askerName(approval, agent);
  return approval.payload.asksBecause ? `${asker} noted: ${own}` : agentReasonLine(asker, own);
}

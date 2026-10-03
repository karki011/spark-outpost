import { isCheckApproval, type Approval } from '@spark-outpost/contracts';
import { commandSummary, fileName } from '../status/status-text.ts';

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

function explainedBySpark(approval: Approval): boolean {
  const { payload } = approval;
  return (
    approval.reason !== null ||
    Boolean(payload.plan) ||
    Boolean(payload.sparkAction) ||
    payload.forcePush !== undefined ||
    payload.gitControl !== undefined ||
    payload.instructionFiles !== undefined ||
    isCheckApproval(approval)
  );
}

function filesPhrase(paths: readonly string[]): string {
  return paths.length === 1 ? `\`${fileName(paths[0]!)}\`` : `${paths.length} files`;
}

function toolCallReason(approval: Approval, agent: string): string | null {
  const { command, paths } = approval.payload;
  if (approval.kind === 'execute' && command) {
    return `${agent} wants to run \`${commandSummary(command)}\`.`;
  }
  if (approval.kind === 'edit' && paths.length > 0) {
    return `${agent} wants to edit ${filesPhrase(paths)}.`;
  }
  return null;
}

export function askReason(approval: Approval, agent: string): string | null {
  const own = approval.payload.agentReason;
  if (own) return agentReasonLine(agent, own);
  return explainedBySpark(approval) ? null : toolCallReason(approval, agent);
}

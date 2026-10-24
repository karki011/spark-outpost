import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';
import { exitPlanText, isExitPlanKind } from '../../plans/plan-mode.ts';
import type { ProviderOutput } from '../../providers/provider.ts';
import { ASK_RUN_REASON } from '../../approvals/ask-run.ts';
import { policyDenial } from '../../approvals/policy-blocked.ts';

export interface PermissionDecision {
  response: RequestPermissionResponse;
  note: string;
}

export const NO_FOLDER_REASON = 'this chat has no project folder';
export const KEPT_PLANNING_REASON = 'Spark asks about plans on its own card';

export function declineInConversation(
  request: RequestPermissionRequest,
  inProject = false,
): PermissionDecision {
  const title = request.toolCall.title?.trim() || 'an action';
  const reject =
    request.options.find((option) => option.kind === 'reject_once') ??
    request.options.find((option) => option.kind === 'reject_always');
  const response: RequestPermissionResponse = reject
    ? { outcome: { outcome: 'selected', optionId: reject.optionId } }
    : { outcome: { outcome: 'cancelled' } };
  if (isExitPlanKind(request.toolCall.kind)) {
    return { response, note: `Kept planning: ${title} (${KEPT_PLANNING_REASON})` };
  }
  const reason = inProject ? ASK_RUN_REASON : NO_FOLDER_REASON;
  const denial = policyDenial(title, reason);
  return {
    response: reject ? { ...response, _meta: { denyMessage: denial } } : response,
    note: `Declined: ${title} (${reason})`,
  };
}

export function nativePlan(
  request: RequestPermissionRequest,
  agentId: string,
  shownPlan: string | null = null,
): ProviderOutput[] {
  const { toolCall } = request;
  const plan =
    exitPlanText(toolCall.kind, toolCall.rawInput, toolCall.content) ??
    (isExitPlanKind(toolCall.kind) ? shownPlan : null);
  if (!plan) return [];
  const source = agentId === 'codex' ? 'codex' : 'claude_plan_mode';
  return [{ kind: 'plan_proposed', plan, toolCallId: toolCall.toolCallId, source }];
}

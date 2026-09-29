import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';
import { exitPlanText } from '../../plans/plan-mode.ts';
import type { ProviderOutput } from '../../providers/provider.ts';

export interface PermissionDecision {
  response: RequestPermissionResponse;
  note: string;
}

export const NO_FOLDER_REASON = 'this chat has no project folder';
export const ASK_MODE_REASON = 'Ask mode only reads files; switch to Do to allow changes';

export function declineInConversation(
  request: RequestPermissionRequest,
  inProject = false,
): PermissionDecision {
  const title = request.toolCall.title?.trim() || 'an action';
  const reject =
    request.options.find((option) => option.kind === 'reject_once') ??
    request.options.find((option) => option.kind === 'reject_always');
  return {
    response: reject
      ? { outcome: { outcome: 'selected', optionId: reject.optionId } }
      : { outcome: { outcome: 'cancelled' } },
    note: `Declined: ${title} (${inProject ? ASK_MODE_REASON : NO_FOLDER_REASON})`,
  };
}

export function nativePlan(request: RequestPermissionRequest, agentId: string): ProviderOutput[] {
  const { toolCall } = request;
  const plan = exitPlanText(toolCall.kind, toolCall.rawInput, toolCall.content);
  if (!plan) return [];
  const source = agentId === 'codex' ? 'codex' : 'claude_plan_mode';
  return [{ kind: 'plan_proposed', plan, toolCallId: toolCall.toolCallId, source }];
}

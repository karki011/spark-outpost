import {
  approvalSchema,
  projectSchema,
  railFlagSchema,
  revertRunResponseSchema,
  runChangesSchema,
  type Approval,
  type ApprovalDecisionRequest,
  type Project,
  type RailFlag,
  type RailFlagDecision,
  type RevertRunResponse,
  type RunChanges,
} from '@spark-outpost/contracts';
import { request } from './client.ts';

export const approvalKeys = {
  changes: (runId: string) => ['run-changes', runId] as const,
};

export const approvalsApi = {
  decide: (id: string, decision: ApprovalDecisionRequest): Promise<Approval> =>
    request(approvalSchema, `/approvals/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify(decision),
    }),
  hold: (id: string): Promise<Approval> =>
    request(approvalSchema, `/approvals/${id}/hold`, { method: 'POST', body: '{}' }),
  changes: (runId: string): Promise<RunChanges> =>
    request(runChangesSchema, `/runs/${runId}/changes`),
  revert: (runId: string): Promise<RevertRunResponse> =>
    request(revertRunResponseSchema, `/runs/${runId}/revert`, { method: 'POST', body: '{}' }),
  decideFlag: (id: string, decision: RailFlagDecision): Promise<RailFlag> =>
    request(railFlagSchema, `/rail-flags/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify(decision),
    }),
  setAllowlist: (projectId: string, commandAllowlist: string[]): Promise<Project> =>
    request(projectSchema, `/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ commandAllowlist }),
    }),
};

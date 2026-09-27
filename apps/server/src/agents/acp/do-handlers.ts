import { homedir } from 'node:os';
import type * as acp from '@agentclientprotocol/sdk';
import type { PathPolicy } from '../../projects/path-policy.ts';
import type { PermissionGate } from '../../providers/provider.ts';
import { writeTextFile } from './fs-handlers.ts';
import { approvalRequestFrom, permissionResponse } from './permission-request.ts';

export interface DoWorkspace {
  policy: PathPolicy;
  cwd: string;
  gate: PermissionGate;
  signal: AbortSignal;
  report: (name: string) => void;
  annotate: (name: string) => void;
}

export async function reviewPermission(
  params: acp.RequestPermissionRequest,
  requestId: string | number | null | undefined,
  workspace: DoWorkspace,
): Promise<acp.RequestPermissionResponse> {
  const request = approvalRequestFrom(params, {
    rpcId: requestId === undefined || requestId === null ? null : String(requestId),
    roots: workspace.policy.roots,
    cwd: workspace.cwd,
    home: homedir(),
  });
  const answer = await workspace.gate.review(request, workspace.signal);
  workspace.annotate(answer.note);
  return permissionResponse(answer);
}

export function writeWithApproval(
  params: acp.WriteTextFileRequest,
  workspace: DoWorkspace,
): Promise<acp.WriteTextFileResponse> {
  return writeTextFile(params, {
    policy: workspace.policy,
    home: homedir(),
    review: (request) => workspace.gate.review(request, workspace.signal),
    report: workspace.report,
    annotate: workspace.annotate,
  });
}

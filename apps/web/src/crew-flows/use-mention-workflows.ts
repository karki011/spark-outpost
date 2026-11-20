import { useQuery } from '@tanstack/react-query';
import type { WorkflowSummary } from '@spark-outpost/contracts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { workflowKeys, workflowsApi } from './workflows-api.ts';

const NONE: WorkflowSummary[] = [];

export function useMentionWorkflows(): WorkflowSummary[] {
  const { remote, session } = useRemoteClient();
  const workflows = useQuery({
    queryKey: workflowKeys.all,
    queryFn: workflowsApi.list,
    enabled: session !== undefined && !remote,
  });
  return workflows.data ?? NONE;
}

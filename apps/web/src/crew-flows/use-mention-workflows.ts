import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkflowSummary } from '@spark-outpost/contracts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { workflowKeys, workflowsApi } from './workflows-api.ts';

const NONE: WorkflowSummary[] = [];

export interface MentionWorkflows {
  workflows: WorkflowSummary[];
  refresh: () => void;
}

export function useMentionWorkflows(): MentionWorkflows {
  const client = useQueryClient();
  const { remote, session } = useRemoteClient();
  const workflows = useQuery({
    queryKey: workflowKeys.all,
    queryFn: workflowsApi.list,
    enabled: session !== undefined && !remote,
  });
  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: workflowKeys.all, exact: true });
  }, [client]);
  return { workflows: workflows.data ?? NONE, refresh };
}

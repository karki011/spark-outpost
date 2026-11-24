import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { usedWorkflowIds, type Workflow } from '@spark-outpost/contracts';
import { useWorkflows } from './use-workflows.ts';
import { workflowKeys, workflowsApi } from './workflows-api.ts';
import type { SparkName } from './workflow-model.ts';

export interface OtherWorkflows {
  names: SparkName[];
  usedIn: SparkName[];
  ready: boolean;
  find: (id: string) => Workflow | null;
}

export function useOtherWorkflows(selfId: string): OtherWorkflows {
  const list = useWorkflows();
  const names = useMemo(
    () =>
      (list.data ?? [])
        .filter((workflow) => workflow.id !== selfId)
        .map(({ id, name }) => ({ id, name })),
    [list.data, selfId],
  );
  const files = useQueries({
    queries: names.map(({ id }) => ({
      queryKey: workflowKeys.one(id),
      queryFn: () => workflowsApi.get(id),
    })),
    combine: (results) => ({
      workflows: results.flatMap((result) => (result.data ? [result.data.workflow] : [])),
      pending: results.some((result) => result.isPending),
    }),
  });
  const ready = list.isSuccess && !files.pending;
  const { workflows } = files;
  return useMemo(() => {
    const byId = new Map(workflows.map((workflow) => [workflow.id, workflow]));
    const usedIn = workflows
      .filter((workflow) => usedWorkflowIds(workflow).includes(selfId))
      .map(({ id, name }) => ({ id, name }));
    return { names, usedIn, ready, find: (id: string) => byId.get(id) ?? null };
  }, [names, ready, workflows, selfId]);
}

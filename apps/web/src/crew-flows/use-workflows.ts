import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SaveWorkflow } from '@spark-outpost/contracts';
import { workflowKeys, workflowsApi } from './workflows-api.ts';

export function useWorkflows() {
  return useQuery({ queryKey: workflowKeys.all, queryFn: workflowsApi.list });
}

export function useWorkflow(id: string | null) {
  return useQuery({
    queryKey: workflowKeys.one(id ?? ''),
    queryFn: () => workflowsApi.get(id!),
    enabled: id !== null,
  });
}

export function useSaveWorkflow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveWorkflow) => workflowsApi.save(input),
    onSuccess: async (file) => {
      client.setQueryData(workflowKeys.one(file.workflow.id), file);
      await client.invalidateQueries({ queryKey: workflowKeys.all, exact: true });
    },
  });
}

export function useDeleteWorkflow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => workflowsApi.remove(id),
    onSuccess: async (_gone, id) => {
      client.removeQueries({ queryKey: workflowKeys.one(id) });
      await client.invalidateQueries({ queryKey: workflowKeys.all, exact: true });
    },
  });
}

export function useStartWorkflowRun() {
  return useMutation({ mutationFn: (id: string) => workflowsApi.startRun(id) });
}

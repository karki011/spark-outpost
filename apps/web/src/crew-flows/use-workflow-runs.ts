import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkflowRun } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { workflowRunKeys, workflowRunsApi } from './runs-api.ts';

const TICK_MS = 1_000;

export function useWorkflowRuns(workflowId: string | null) {
  return useQuery({
    queryKey: workflowRunKeys.list(workflowId ?? ''),
    queryFn: () => workflowRunsApi.list(workflowId!),
    enabled: workflowId !== null,
  });
}

export function useWorkflowRun(runId: string, seed?: WorkflowRun) {
  return useQuery({
    queryKey: workflowRunKeys.one(runId),
    queryFn: () => workflowRunsApi.get(runId),
    ...(seed ? { initialData: seed, initialDataUpdatedAt: 0 } : {}),
  });
}

export function useStopWorkflowRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => workflowRunsApi.stop(runId),
    onSuccess: (run) => {
      client.setQueryData(workflowRunKeys.one(run.id), run);
    },
  });
}

export function useRunChat(conversationId: string | null) {
  return useQuery({
    queryKey: queryKeys.conversation(conversationId ?? ''),
    queryFn: () => api.getConversation(conversationId!),
    enabled: conversationId !== null,
  });
}

export function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

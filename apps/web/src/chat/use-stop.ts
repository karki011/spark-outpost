import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ConversationDetail } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { activeRuns } from './turns.ts';

const STOP_TIMEOUT_MS = 10_000;
const STOP_POLL_MS = 1_000;
const STOP_UNCONFIRMED = "Spark didn't confirm the stop. Try Stop again.";

export interface StopControl {
  stopping: boolean;
  error: string | null;
  stop(): void;
}

function markStopping(detail: ConversationDetail, runIds: readonly string[], on: boolean) {
  return {
    ...detail,
    runs: detail.runs.map((run) =>
      runIds.includes(run.id) ? { ...run, cancelRequested: on } : run,
    ),
  };
}

function stopErrorText(error: Error): string {
  return error.name === 'TimeoutError' || error.name === 'AbortError'
    ? STOP_UNCONFIRMED
    : `Couldn't stop: ${error.message}`;
}

export function useStop(
  conversationId: string,
  detail: ConversationDetail | undefined,
  refresh: () => Promise<unknown>,
): StopControl {
  const queryClient = useQueryClient();
  const key = queryKeys.conversation(conversationId);
  const active = activeRuns(detail);
  const stop = useMutation({
    mutationFn: (runIds: string[]) =>
      Promise.all(
        runIds.map((runId) => api.cancelRun(runId, AbortSignal.timeout(STOP_TIMEOUT_MS))),
      ),
    onMutate: (runIds) => {
      queryClient.setQueryData<ConversationDetail>(
        key,
        (current) => current && markStopping(current, runIds, true),
      );
    },
    onError: (_error, runIds) => {
      queryClient.setQueryData<ConversationDetail>(
        key,
        (current) => current && markStopping(current, runIds, false),
      );
    },
    onSettled: refresh,
  });
  const stopping =
    active.length > 0 && (stop.isPending || active.every((run) => run.cancelRequested));

  useEffect(() => {
    if (!stopping) return;
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) });
    }, STOP_POLL_MS);
    return () => clearInterval(timer);
  }, [stopping, queryClient, conversationId]);

  return {
    stopping,
    error: stop.error && active.length > 0 ? stopErrorText(stop.error) : null,
    stop: () => {
      if (active.length === 0 || stopping) return;
      stop.mutate(active.map((run) => run.id));
    },
  };
}

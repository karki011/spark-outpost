import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sparkPauseApi, sparkPauseKey } from './spark-pause-api.ts';

export interface SparkPauseControl {
  paused: boolean;
  saving: boolean;
  setPaused: (paused: boolean) => void;
}

export function useSparkPaused(): boolean {
  const state = useQuery({ queryKey: sparkPauseKey, queryFn: sparkPauseApi.get });
  return (state.data?.pausedAt ?? null) !== null;
}

export function useSparkPause(): SparkPauseControl {
  const queryClient = useQueryClient();
  const paused = useSparkPaused();
  const change = useMutation({
    mutationFn: sparkPauseApi.set,
    onSuccess: (next) => queryClient.setQueryData(sparkPauseKey, next),
  });
  return {
    paused,
    saving: change.isPending,
    setPaused: (paused) => change.mutate(paused),
  };
}

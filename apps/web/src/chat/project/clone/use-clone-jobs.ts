import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CloneJob, CloneJobs } from '@spark-outpost/contracts';
import { cloneApi, cloneKeys } from './clone-api.ts';

const POLL_MS = 500;

function withJob(list: CloneJobs | undefined, job: CloneJob): CloneJobs {
  const others = (list?.jobs ?? []).filter((entry) => entry.id !== job.id);
  return { jobs: [...others, job] };
}

export function useCloneJobs(enabled: boolean) {
  const queryClient = useQueryClient();
  const jobs = useQuery({
    queryKey: cloneKeys.jobs,
    queryFn: cloneApi.jobs,
    enabled,
    refetchInterval: (query) =>
      query.state.data?.jobs.some((job) => job.status === 'cloning') ? POLL_MS : false,
  });
  const keep = (job: CloneJob) =>
    queryClient.setQueryData<CloneJobs>(cloneKeys.jobs, (list) => withJob(list, job));
  const start = useMutation({ mutationFn: cloneApi.start, onSuccess: keep });
  const cancel = useMutation({ mutationFn: cloneApi.cancel, onSuccess: keep });
  const dismiss = useMutation({
    mutationFn: cloneApi.dismiss,
    onSuccess: (list) => queryClient.setQueryData(cloneKeys.jobs, list),
  });
  return { job: jobs.data?.jobs.at(-1) ?? null, loaded: jobs.isSuccess, start, cancel, dismiss };
}

export function useCloneNeedsAttention(enabled: boolean): boolean {
  const jobs = useQuery({ queryKey: cloneKeys.jobs, queryFn: cloneApi.jobs, enabled });
  return jobs.data?.jobs.some((job) => job.status !== 'cancelled') ?? false;
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CloudflareReach } from '@spark-outpost/contracts';
import { openOutside } from '../browser/outside-link.ts';
import { cloudflareApi, cloudflareKeys } from './cloudflare-api.ts';

const POLL_MS = 1500;
const moving = (reach: CloudflareReach | undefined) =>
  reach?.status === 'waiting' || reach?.status === 'working';

export function useCloudflareReach() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: cloudflareKeys.reach,
    queryFn: cloudflareApi.reach,
    refetchInterval: (state) => (moving(state.state.data) ? POLL_MS : false),
  });
  const keep = async (reach: CloudflareReach) => {
    await queryClient.cancelQueries({ queryKey: cloudflareKeys.reach });
    queryClient.setQueryData(cloudflareKeys.reach, reach);
    if (reach.authorizeUrl) openOutside(reach.authorizeUrl);
  };
  const start = useMutation({ mutationFn: cloudflareApi.startReach, onSuccess: keep });
  const resume = useMutation({ mutationFn: cloudflareApi.resumeReach, onSuccess: keep });
  const cancel = useMutation({ mutationFn: cloudflareApi.cancelReach, onSuccess: keep });
  return {
    reach: query.data,
    busy: start.isPending || resume.isPending || cancel.isPending,
    error: start.error ?? resume.error ?? cancel.error,
    start: start.mutate,
    resume: () => resume.mutate(),
    cancel: () => cancel.mutate(),
  };
}

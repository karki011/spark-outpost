import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CloudflareConnection } from '@spark-outpost/contracts';
import { ARTIFACT_SHARE_KEY, cloudflareApi, cloudflareKeys } from './cloudflare-api.ts';

export function useCloudflareConnection(enabled: boolean) {
  return useQuery({
    queryKey: cloudflareKeys.connection,
    queryFn: cloudflareApi.connection,
    enabled,
  });
}

export function useCloudflareSaved() {
  const queryClient = useQueryClient();
  return async (connection: CloudflareConnection) => {
    await queryClient.cancelQueries({ queryKey: cloudflareKeys.connection });
    queryClient.setQueryData(cloudflareKeys.connection, connection);
    void queryClient.invalidateQueries({ queryKey: ARTIFACT_SHARE_KEY });
  };
}

export function useCloudflareActions() {
  const queryClient = useQueryClient();
  const saved = useCloudflareSaved();
  const update = useMutation({ mutationFn: cloudflareApi.update, onSuccess: saved });
  const check = useMutation({ mutationFn: cloudflareApi.check, onSuccess: saved });
  const disconnect = useMutation({
    mutationFn: cloudflareApi.disconnect,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: cloudflareKeys.connection });
      void queryClient.invalidateQueries({ queryKey: ARTIFACT_SHARE_KEY });
    },
  });
  return { update, check, disconnect };
}

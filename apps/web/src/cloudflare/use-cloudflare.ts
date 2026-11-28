import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CloudflareConnection, CloudflareSetup } from '@spark-outpost/contracts';
import { openOutside } from '../browser/outside-link.ts';
import { ARTIFACT_SHARE_KEY, cloudflareApi, cloudflareKeys } from './cloudflare-api.ts';
import { newShareKeys, type ShareKeys } from './share-keys.ts';

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
    if (connection.connected) queryClient.removeQueries({ queryKey: cloudflareKeys.madeKeys });
    void queryClient.invalidateQueries({ queryKey: ARTIFACT_SHARE_KEY });
  };
}

export function useMadeShareKeys(): ShareKeys {
  return useQuery({
    queryKey: cloudflareKeys.madeKeys,
    queryFn: newShareKeys,
    initialData: newShareKeys,
    staleTime: Infinity,
    gcTime: Infinity,
  }).data;
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
      void queryClient.invalidateQueries({ queryKey: cloudflareKeys.setup });
      void queryClient.invalidateQueries({ queryKey: ARTIFACT_SHARE_KEY });
    },
  });
  return { update, check, disconnect };
}

const SETUP_POLL_MS = 1500;
const setupMoving = (setup: CloudflareSetup | undefined) =>
  setup?.status === 'waiting' || setup?.status === 'working';

export function useCloudflareSetup() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: cloudflareKeys.setup,
    queryFn: cloudflareApi.setup,
    refetchInterval: (state) => (setupMoving(state.state.data) ? SETUP_POLL_MS : false),
  });
  const keep = async (setup: CloudflareSetup) => {
    await queryClient.cancelQueries({ queryKey: cloudflareKeys.setup });
    queryClient.setQueryData(cloudflareKeys.setup, setup);
  };
  const start = useMutation({
    mutationFn: cloudflareApi.startSetup,
    onSuccess: async (setup) => {
      if (setup.authorizeUrl) openOutside(setup.authorizeUrl);
      await keep(setup);
    },
  });
  const cancel = useMutation({
    mutationFn: cloudflareApi.cancelSetup,
    onSuccess: async (setup) => {
      await keep(setup);
      void queryClient.invalidateQueries({ queryKey: cloudflareKeys.connection });
    },
  });
  const done = query.data?.status === 'done';
  useEffect(() => {
    if (!done) return;
    void queryClient.invalidateQueries({ queryKey: cloudflareKeys.connection });
    void queryClient.invalidateQueries({ queryKey: ARTIFACT_SHARE_KEY });
  }, [done, queryClient]);
  return {
    setup: query.data,
    loading: query.isPending,
    loadError: query.data === undefined ? query.error : null,
    reload: () => void query.refetch(),
    busy: start.isPending || cancel.isPending,
    error: start.error ?? cancel.error,
    start: () => {
      cancel.reset();
      start.mutate();
    },
    cancel: () => {
      start.reset();
      cancel.mutate();
    },
  };
}

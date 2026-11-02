import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserPlugin } from '@spark-outpost/contracts';
import { userPluginsApi, userPluginsKey } from '../api/user-plugins.ts';
import { filterPlugins, isChecking, sortPlugins } from './plugin-model.ts';

const CHECKING_POLL_MS = 2_000;

export function useUserPlugins() {
  return useQuery({
    queryKey: userPluginsKey,
    queryFn: userPluginsApi.list,
    refetchInterval: (query) =>
      query.state.data?.plugins.some(isChecking) ? CHECKING_POLL_MS : false,
  });
}

export function usePluginSwitch(plugin: UserPlugin) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ enabled, confirmFindings }: { enabled: boolean; confirmFindings: boolean }) =>
      userPluginsApi.set(plugin.key, {
        enabled,
        fingerprint: plugin.fingerprint,
        confirmFindings,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: userPluginsKey }),
  });
  const error = mutation.error ? mutation.error.message : null;
  return {
    busy: mutation.isPending,
    error,
    set: (enabled: boolean, confirmFindings = false) =>
      mutation.mutate({ enabled, confirmFindings }),
  };
}

function arrange(plugins: readonly UserPlugin[], filter: string): string[] {
  return sortPlugins(filterPlugins(plugins, filter)).map((plugin) => plugin.key);
}

export function useSteadyOrder(plugins: readonly UserPlugin[], filter: string): UserPlugin[] {
  const signature = `${filter}\n${plugins
    .map((plugin) => plugin.key)
    .sort()
    .join('\n')}`;
  const [frozen, setFrozen] = useState(() => ({ signature, keys: arrange(plugins, filter) }));
  let keys = frozen.keys;
  if (frozen.signature !== signature) {
    keys = arrange(plugins, filter);
    setFrozen({ signature, keys });
  }
  const byKey = new Map(plugins.map((plugin) => [plugin.key, plugin]));
  return keys.flatMap((key) => byKey.get(key) ?? []);
}

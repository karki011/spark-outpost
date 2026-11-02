import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { userPluginsApi, userPluginsKey } from '../../api/user-plugins.ts';
import { useRemoteClient } from '../../phone/use-remote-client.ts';
import { loadedPluginCommands } from './slash.ts';

const PLUGINS_FRESH_MS = 5 * 60_000;
const NO_COMMANDS: readonly string[] = [];

export function usePluginCommands(provider: string | null): readonly string[] {
  const { remote } = useRemoteClient();
  const enabled = provider === 'claude' && !remote;
  const plugins = useQuery({
    queryKey: userPluginsKey,
    queryFn: userPluginsApi.list,
    enabled,
    staleTime: PLUGINS_FRESH_MS,
    retry: false,
  });
  return useMemo(
    () => (enabled && plugins.data ? loadedPluginCommands(plugins.data.plugins) : NO_COMMANDS),
    [enabled, plugins.data],
  );
}

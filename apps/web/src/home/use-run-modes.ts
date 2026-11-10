import { useQueries } from '@tanstack/react-query';
import type { ProviderCapabilities, ProviderId } from '@spark-outpost/contracts';
import { CAPABILITIES_STALE_MS, capabilitiesQuery } from '../api/client.ts';
import type { RunItem } from './home-model.ts';
import { runProvider, type CapabilitiesByProvider } from './run-mode.ts';

export function useRunModes(running: readonly RunItem[]): CapabilitiesByProvider {
  const providers = [
    ...new Set(running.flatMap((item) => runProvider(item.chat) ?? [])),
  ].toSorted();
  const loaded = useQueries({
    queries: providers.map((provider) => ({
      ...capabilitiesQuery(provider),
      staleTime: CAPABILITIES_STALE_MS,
    })),
  });
  const entries = providers.flatMap((provider, index): [ProviderId, ProviderCapabilities][] => {
    const data = loaded[index]?.data;
    return data ? [[provider, data]] : [];
  });
  return new Map(entries);
}

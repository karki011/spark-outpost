import { useQuery } from '@tanstack/react-query';
import type { MacControlStatus } from '@spark-outpost/contracts';
import { desktopMacControl } from '../desktop/desktop-bridge.ts';

export const MAC_CONTROL_STATUS_KEY = ['mac-control', 'status'] as const;

export function macControlHelperMissing(status: MacControlStatus | null | undefined): boolean {
  return status?.helper === 'missing' || status?.helper === 'failed';
}

export function useMacControlStatus() {
  return useQuery({
    queryKey: MAC_CONTROL_STATUS_KEY,
    queryFn: async () => (await desktopMacControl()?.status()) ?? null,
    refetchOnWindowFocus: 'always',
  });
}

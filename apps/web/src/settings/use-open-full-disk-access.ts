import { useQueryClient } from '@tanstack/react-query';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import { fullDiskAccessQuery } from './full-disk-access-status.ts';

export function useOpenFullDiskAccess(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    const privacy = sparkDesktop()?.privacy;
    if (privacy) await privacy.openFullDiskAccess();
    await queryClient.invalidateQueries({ queryKey: fullDiskAccessQuery.queryKey });
  };
}

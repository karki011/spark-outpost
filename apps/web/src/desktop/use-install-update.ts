import { useCallback } from 'react';
import type { InstallResult } from '@spark-outpost/contracts';
import { sparkDesktop } from './desktop-bridge.ts';

export function useInstallUpdate(): () => Promise<InstallResult | null> {
  return useCallback(async () => {
    const updates = sparkDesktop()?.updates;
    return updates ? updates.install() : null;
  }, []);
}

export function installMessage(result: InstallResult | null): string | null {
  if (!result) return null;
  return result.status === 'waiting' || result.status === 'unavailable' ? result.reason : null;
}

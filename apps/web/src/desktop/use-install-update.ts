import { useCallback, useState } from 'react';
import { sparkDesktop } from './desktop-bridge.ts';

export function useInstallUpdate() {
  const [blocked, setBlocked] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const install = useCallback(async () => {
    const updates = sparkDesktop()?.updates;
    if (!updates) return null;
    setStarting(true);
    const result = await updates.install();
    setStarting(false);
    const reason = result.started ? null : result.reason;
    setBlocked(reason);
    return reason;
  }, []);
  return { install, blocked, starting };
}

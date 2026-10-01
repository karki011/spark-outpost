import { useEffect, useState } from 'react';
import { sparkDesktop, type CompanionStatus } from './desktop-bridge.ts';

export function useCompanionStatus(): CompanionStatus | null {
  const [status, setStatus] = useState<CompanionStatus | null>(null);
  useEffect(() => {
    const desktop = sparkDesktop();
    if (!desktop) return;
    let live = true;
    void desktop.companion.get().then((next) => {
      if (live) setStatus(next);
    });
    const off = desktop.companion.onChange(setStatus);
    return () => {
      live = false;
      off();
    };
  }, []);
  return status;
}

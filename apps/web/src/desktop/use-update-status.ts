import { useEffect, useState } from 'react';
import type { UpdateStatus } from '@spark-outpost/contracts';
import { sparkDesktop } from './desktop-bridge.ts';

export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    const updates = sparkDesktop()?.updates;
    if (!updates) return;
    let live = true;
    void updates.get().then((next) => {
      if (live) setStatus(next);
    });
    const off = updates.onChange(setStatus);
    return () => {
      live = false;
      off();
    };
  }, []);
  return status;
}

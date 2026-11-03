import { useState } from 'react';
import type { BrowserProfile } from '@spark-outpost/contracts';
import { sendViewCommand } from './view-store.ts';

export function useSplitRatio(profile: BrowserProfile, saved: number) {
  const [moving, setMoving] = useState<number | null>(null);
  if (moving === saved) setMoving(null);
  const commit = (ratio: number) => {
    setMoving(ratio);
    sendViewCommand(profile, { command: 'split_ratio', ratio });
  };
  return { ratio: moving ?? saved, move: setMoving, commit };
}

import { useEffect, useReducer, useState } from 'react';
import type { ResetState } from './reset-store.ts';
import {
  nextResetBlobMood,
  settles,
  SETTLE_MS,
  type ResetBlobEvent,
  type ResetBlobMood,
} from './reset-blob-mood.ts';

export function useResetBlobMood(
  phase: ResetState['phase'],
): [ResetBlobMood, (event: ResetBlobEvent) => void] {
  const [mood, dispatch] = useReducer(nextResetBlobMood, 'calm');
  const [seenPhase, setSeenPhase] = useState(phase);

  if (seenPhase !== phase) {
    setSeenPhase(phase);
    if (seenPhase === 'counting' && phase === 'idle') dispatch({ phase: 'undone' });
    else if (phase === 'failed') dispatch({ phase: 'settled' });
  }

  useEffect(() => {
    if (!settles(mood)) return;
    const timer = setTimeout(() => dispatch({ phase: 'settled' }), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [mood]);

  return [mood, dispatch];
}

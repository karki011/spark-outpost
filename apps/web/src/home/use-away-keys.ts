import { useEffect, useState } from 'react';
import type { AttentionItem } from '@spark-outpost/contracts';
import { awayKeys } from './since-model.ts';

const NONE: ReadonlySet<string> = new Set();
let homeSeen = false;

export function useAwayKeys(
  items: readonly AttentionItem[],
  loaded: boolean,
): { keys: ReadonlySet<string>; ready: boolean } {
  const [keys, setKeys] = useState<ReadonlySet<string> | null>(() => (homeSeen ? NONE : null));
  if (keys === null && loaded) setKeys(awayKeys(items));
  useEffect(() => {
    if (loaded) homeSeen = true;
  }, [loaded]);
  return { keys: keys ?? NONE, ready: keys !== null };
}

import { useCallback, useState } from 'react';
import { cardKey, type Card } from './island-model.ts';

const STORE_KEY = 'spark-outpost.island.set-aside';

export function readSetAside(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((key) => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

function writeSetAside(keys: readonly string[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(keys));
  } catch {
    return;
  }
}

export function stillWaiting(keys: readonly string[], pending: readonly Card[]): string[] {
  if (pending.some((card) => card.loading)) return [...keys];
  const waiting = new Set(pending.map(cardKey));
  return keys.filter((key) => waiting.has(key));
}

export function useSetAside(pending: readonly Card[]) {
  const [keys, setKeys] = useState<ReadonlySet<string>>(() => new Set(readSetAside()));
  const setAside = useCallback(
    (card: Card) => {
      const key = cardKey(card);
      const kept = stillWaiting(readSetAside(), pending).filter((saved) => saved !== key);
      writeSetAside([...kept, key]);
      setKeys((current) => new Set([...current, key]));
    },
    [pending],
  );
  return { keys, setAside };
}

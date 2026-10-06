import { useCallback, useState } from 'react';

const STORE_KEY = 'spark-outpost.pr-card.dismissed';
const MAX_CHATS = 200;

type Stored = Record<string, string[]>;

function read(): Stored {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Stored) : {};
  } catch {
    return {};
  }
}

function write(conversationId: string, keys: readonly string[]): void {
  try {
    const others = Object.entries(read()).filter(([id]) => id !== conversationId);
    const kept = others.slice(-(MAX_CHATS - 1));
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify(Object.fromEntries([...kept, [conversationId, keys]])),
    );
  } catch {
    return;
  }
}

function keysOf(conversationId: string): string[] {
  const keys = read()[conversationId];
  return Array.isArray(keys) ? keys.filter((key) => typeof key === 'string') : [];
}

export function useDismissedPulls(
  conversationId: string,
): [ReadonlySet<string>, (key: string) => void] {
  const [state, setState] = useState(() => ({
    conversationId,
    keys: new Set(keysOf(conversationId)),
  }));
  const current =
    state.conversationId === conversationId ? state.keys : new Set(keysOf(conversationId));
  const dismiss = useCallback(
    (key: string) => {
      const keys = new Set([...keysOf(conversationId), key]);
      write(conversationId, [...keys]);
      setState({ conversationId, keys });
    },
    [conversationId],
  );
  return [current, dismiss];
}

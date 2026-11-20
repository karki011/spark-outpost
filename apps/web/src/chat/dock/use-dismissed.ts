import { useCallback, useState } from 'react';

const MAX_CHATS = 200;

type Stored = Record<string, string[]>;

function read(storeKey: string): Stored {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storeKey) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Stored) : {};
  } catch {
    return {};
  }
}

function write(storeKey: string, conversationId: string, keys: readonly string[]): void {
  try {
    const others = Object.entries(read(storeKey)).filter(([id]) => id !== conversationId);
    const kept = others.slice(-(MAX_CHATS - 1));
    localStorage.setItem(
      storeKey,
      JSON.stringify(Object.fromEntries([...kept, [conversationId, keys]])),
    );
  } catch {
    return;
  }
}

function keysOf(storeKey: string, conversationId: string): string[] {
  const keys = read(storeKey)[conversationId];
  return Array.isArray(keys) ? keys.filter((key) => typeof key === 'string') : [];
}

export function useDismissed(
  storeKey: string,
  conversationId: string,
): [ReadonlySet<string>, (key: string) => void] {
  const [state, setState] = useState(() => ({
    conversationId,
    keys: new Set(keysOf(storeKey, conversationId)),
  }));
  const current =
    state.conversationId === conversationId
      ? state.keys
      : new Set(keysOf(storeKey, conversationId));
  const dismiss = useCallback(
    (key: string) => {
      const keys = new Set([...keysOf(storeKey, conversationId), key]);
      write(storeKey, conversationId, [...keys]);
      setState({ conversationId, keys });
    },
    [storeKey, conversationId],
  );
  return [current, dismiss];
}

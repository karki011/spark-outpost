import { useEffect, useSyncExternalStore } from 'react';

const ON_SCREEN_KEY = 'spark-outpost.on-screen-chat';

function read(): string | null {
  try {
    return localStorage.getItem(ON_SCREEN_KEY);
  } catch {
    return null;
  }
}

function write(chatId: string | null): void {
  try {
    if (chatId) localStorage.setItem(ON_SCREEN_KEY, chatId);
    else localStorage.removeItem(ON_SCREEN_KEY);
  } catch {
    return;
  }
}

function subscribe(changed: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === ON_SCREEN_KEY) changed();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

export function useShareOnScreenChat(chatId: string | null): void {
  useEffect(() => {
    write(chatId);
    return () => write(null);
  }, [chatId]);
}

export function useOnScreenChat(): string | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

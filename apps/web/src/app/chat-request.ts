import { useEffect } from 'react';

const listeners = new Set<(conversationId: string) => void>();

export function requestChat(conversationId: string): void {
  for (const listener of listeners) listener(conversationId);
}

export function useChatRequests(open: (conversationId: string) => void): void {
  useEffect(() => {
    listeners.add(open);
    return () => {
      listeners.delete(open);
    };
  }, [open]);
}

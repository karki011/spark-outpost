import { useEffect } from 'react';

const unsent = new Set<string>();

export function useUnsentText(conversationId: string, hasText: boolean): void {
  useEffect(() => {
    if (!hasText) return;
    unsent.add(conversationId);
    return () => {
      unsent.delete(conversationId);
    };
  }, [conversationId, hasText]);
}

export function hasUnsentText(conversationId: string): boolean {
  return unsent.has(conversationId);
}

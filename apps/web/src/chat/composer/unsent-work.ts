import { useEffect } from 'react';

const unsent = new Set<string>();

export function useUnsentWork(conversationId: string, hasWork: boolean): void {
  useEffect(() => {
    if (!hasWork) return;
    unsent.add(conversationId);
    return () => {
      unsent.delete(conversationId);
    };
  }, [conversationId, hasWork]);
}

export function hasUnsentWork(conversationId: string): boolean {
  return unsent.has(conversationId);
}

import { createContext } from 'react';

export interface FollowRequests {
  request(): void;
  subscribe(listener: () => void): () => void;
}

export function createFollowRequests(): FollowRequests {
  const listeners = new Set<() => void>();
  return {
    request() {
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const FollowContext = createContext<FollowRequests | null>(null);

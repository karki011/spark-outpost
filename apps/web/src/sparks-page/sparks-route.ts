import { useEffect } from 'react';

export type SparksPageTab = 'crew' | 'workflows';

export interface SparksPageRequest {
  sparkId: string | null;
  tab: SparksPageTab;
  builder?: boolean;
}

let pending: SparksPageRequest | null = null;
const listeners = new Set<() => void>();
const appOpeners = new Set<() => void>();

function ask(request: SparksPageRequest): void {
  pending = request;
  appOpeners.forEach((open) => open());
  listeners.forEach((listener) => listener());
}

export function openSparksPage(sparkId: string | null = null, tab: SparksPageTab = 'crew'): void {
  ask({ sparkId, tab });
}

export function openBuilderChat(): void {
  ask({ sparkId: null, tab: 'crew', builder: true });
}

export function useSparksPageOpener(open: () => void): void {
  useEffect(() => {
    appOpeners.add(open);
    return () => {
      appOpeners.delete(open);
    };
  }, [open]);
}

export function useSparksPageRequests(select: (request: SparksPageRequest) => void): void {
  useEffect(() => {
    const take = () => {
      const asked = pending;
      pending = null;
      if (asked) select(asked);
    };
    take();
    listeners.add(take);
    return () => {
      listeners.delete(take);
    };
  }, [select]);
}

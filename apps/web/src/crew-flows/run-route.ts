import { useEffect } from 'react';
import { openSparksPage } from '../sparks-page/sparks-route.ts';

let pending: string | null = null;
const listeners = new Set<() => void>();

export function openWorkflowRun(runId: string): void {
  pending = runId;
  openSparksPage(null, 'workflows');
  listeners.forEach((listener) => listener());
}

export function useWorkflowRunRequests(open: (runId: string) => void): void {
  useEffect(() => {
    const take = () => {
      const asked = pending;
      pending = null;
      if (asked) open(asked);
    };
    take();
    listeners.add(take);
    return () => {
      listeners.delete(take);
    };
  }, [open]);
}

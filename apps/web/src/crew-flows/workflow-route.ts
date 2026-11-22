import { useEffect } from 'react';
import { openSparksPage } from '../sparks-page/sparks-route.ts';

let pending: string | null = null;
const listeners = new Set<() => void>();

export function openWorkflow(workflowId: string): void {
  pending = workflowId;
  openSparksPage(null, 'workflows');
  listeners.forEach((listener) => listener());
}

export function useWorkflowRequests(open: (workflowId: string) => void): void {
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

import { createContext, use, useEffect } from 'react';
import type { RunStep } from '../run-projection.ts';
import type { PendingSummary } from './pending-summary.ts';
import type { StatusStore, Worker } from './status-store.ts';

export const StatusContext = createContext<StatusStore | null>(null);

export function usePendingEntry(
  id: string,
  order: string,
  summary: PendingSummary,
  pending: boolean,
): void {
  const store = use(StatusContext);
  const { action, subject, code, full } = summary;
  useEffect(() => {
    if (!store || !pending) return;
    store.register({ id, order, summary: { action, subject, code, full } });
    return () => store.unregister(id);
  }, [store, pending, id, order, action, subject, code, full]);
}

function openStep(steps: readonly RunStep[]): string | null {
  return steps.findLast((step) => !step.done)?.name ?? null;
}

export function useLiveReport(
  { id, name, provider, kind }: Worker,
  working: boolean,
  steps: readonly RunStep[],
): void {
  const store = use(StatusContext);
  const step = working ? openStep(steps) : null;
  useEffect(() => {
    store?.report({ id, name, provider, kind, working, step });
  }, [store, id, name, provider, kind, working, step]);
  useEffect(() => () => store?.forget(id), [store, id]);
}

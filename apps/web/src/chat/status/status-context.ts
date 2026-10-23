import { createContext, use, useCallback, useEffect } from 'react';
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
  return steps.findLast((step) => !step.done && !step.subagent && !step.waits)?.name ?? null;
}

export function useLiveReport(
  { id, name, provider, kind, doing, todo }: Worker,
  working: boolean,
  steps: readonly RunStep[],
): void {
  const store = use(StatusContext);
  const step = working ? openStep(steps) : null;
  useEffect(() => {
    store?.report({
      id,
      name,
      provider,
      kind,
      working,
      step,
      ...(doing ? { doing } : {}),
      ...(todo ? { todo } : {}),
    });
  }, [store, id, name, provider, kind, doing, todo, working, step]);
  useEffect(() => () => store?.forget(id), [store, id]);
}

export function useActionReport(id: string, doing: string | null): void {
  const store = use(StatusContext);
  useEffect(() => {
    if (!store || !doing) return;
    store.report({
      id,
      name: 'Spark',
      provider: 'spark',
      kind: 'crew',
      working: true,
      step: doing,
    });
    return () => store.forget(id);
  }, [store, id, doing]);
}

export function usePendingArrival(onArrival: () => void): void {
  const store = use(StatusContext);
  useEffect(() => {
    if (!store) return;
    let known = new Set(store.snapshot().pending.map((entry) => entry.id));
    return store.subscribe(() => {
      const ids = store.snapshot().pending.map((entry) => entry.id);
      const arrived = ids.some((id) => !known.has(id));
      known = new Set(ids);
      if (arrived) onArrival();
    });
  }, [store, onArrival]);
}

export function useLiveHead(id: string | null) {
  const store = use(StatusContext);
  return useCallback(
    (element: HTMLElement | null) => {
      if (!element || !store || !id || typeof IntersectionObserver !== 'function') return;
      const view = new IntersectionObserver(
        (entries) => store.showHead(id, entries.at(-1)?.isIntersecting ?? false),
        { root: element.closest('.thread') },
      );
      view.observe(element);
      return () => {
        view.disconnect();
        store.showHead(id, false);
      };
    },
    [store, id],
  );
}

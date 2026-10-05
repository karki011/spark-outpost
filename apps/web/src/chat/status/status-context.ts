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

const SHORT_TURN_PX = 320;

export function useLiveHead(id: string | null) {
  const store = use(StatusContext);
  return useCallback(
    (element: HTMLElement | null) => {
      if (!element || !store || !id || typeof IntersectionObserver !== 'function') return;
      const block = element.parentElement ?? element;
      let seen = false;
      let short = block.getBoundingClientRect().height <= SHORT_TURN_PX;
      const report = () => store.showHead(id, seen && short);
      const view = new IntersectionObserver(
        (entries) => {
          seen = entries.at(-1)?.isIntersecting ?? false;
          report();
        },
        { root: element.closest('.thread') },
      );
      const size = new ResizeObserver((entries) => {
        short = (entries.at(-1)?.contentRect.height ?? 0) <= SHORT_TURN_PX;
        report();
      });
      view.observe(element);
      size.observe(block);
      return () => {
        view.disconnect();
        size.disconnect();
        store.showHead(id, false);
      };
    },
    [store, id],
  );
}

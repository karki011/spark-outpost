import { useEffect, useSyncExternalStore } from 'react';
import type { LeadStep } from '../chat/turn/live-label.ts';

export type LeadSteps = ReadonlyMap<string, LeadStep>;

let shown: LeadSteps = new Map();
const listeners = new Set<() => void>();

function publish(next: LeadSteps) {
  shown = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setLeadStep(runId: string, step: LeadStep | null) {
  const known = shown.get(runId);
  if (step && known?.label === step.label && known.since === step.since) return;
  if (!step && !known) return;
  const next = new Map(shown);
  if (step) next.set(runId, step);
  else next.delete(runId);
  publish(next);
}

export function useReportLeadStep(runId: string, step: LeadStep | null): void {
  const label = step?.label ?? null;
  const since = step?.since ?? null;
  useEffect(() => {
    setLeadStep(runId, label === null ? null : { label, since });
    return () => setLeadStep(runId, null);
  }, [runId, label, since]);
}

export function useLeadSteps(): LeadSteps {
  return useSyncExternalStore(subscribe, () => shown);
}

import type { PendingSummary } from './pending-summary.ts';

export interface PendingEntry {
  id: string;
  order: string;
  summary: PendingSummary;
}

export type WorkerKind = 'agent' | 'crew' | 'lead';

export interface Worker {
  id: string;
  name: string;
  provider: string;
  kind: WorkerKind;
}

export interface LiveInput extends Worker {
  working: boolean;
  step: string | null;
}

export interface LiveReport extends LiveInput {
  since: number;
}

export interface StatusSnapshot {
  pending: readonly PendingEntry[];
  live: readonly LiveReport[];
  headsInView: readonly string[];
}

export interface StatusStore {
  subscribe(listener: () => void): () => void;
  snapshot(): StatusSnapshot;
  register(entry: PendingEntry): void;
  unregister(id: string): void;
  report(input: LiveInput): void;
  forget(id: string): void;
  showHead(id: string, inView: boolean): void;
}

function byAge(a: PendingEntry, b: PendingEntry): number {
  return a.order.localeCompare(b.order) || a.id.localeCompare(b.id);
}

function sameSummary(a: PendingSummary, b: PendingSummary): boolean {
  return a.action === b.action && a.subject === b.subject && a.code === b.code && a.full === b.full;
}

function sameEntry(a: PendingEntry | undefined, b: PendingEntry): boolean {
  return a !== undefined && a.order === b.order && sameSummary(a.summary, b.summary);
}

function sameReport(a: LiveReport | undefined, b: LiveInput): boolean {
  if (!a) return false;
  return (
    a.name === b.name &&
    a.kind === b.kind &&
    a.provider === b.provider &&
    a.working === b.working &&
    a.step === b.step
  );
}

export function createStatusStore(now: () => number = Date.now): StatusStore {
  let state: StatusSnapshot = { pending: [], live: [], headsInView: [] };
  const listeners = new Set<() => void>();
  const publish = (next: StatusSnapshot) => {
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => state,
    register(entry) {
      const known = state.pending.find((candidate) => candidate.id === entry.id);
      if (sameEntry(known, entry)) return;
      const others = state.pending.filter((known) => known.id !== entry.id);
      publish({ ...state, pending: [...others, entry].sort(byAge) });
    },
    unregister(id) {
      if (!state.pending.some((entry) => entry.id === id)) return;
      publish({ ...state, pending: state.pending.filter((entry) => entry.id !== id) });
    },
    report(input) {
      const known = state.live.find((report) => report.id === input.id);
      if (sameReport(known, input)) return;
      const since = known && known.step === input.step ? known.since : now();
      const others = state.live.filter((report) => report.id !== input.id);
      publish({ ...state, live: [...others, { ...input, since }] });
    },
    forget(id) {
      if (!state.live.some((report) => report.id === id)) return;
      publish({ ...state, live: state.live.filter((report) => report.id !== id) });
    },
    showHead(id, inView) {
      if (state.headsInView.includes(id) === inView) return;
      const others = state.headsInView.filter((known) => known !== id);
      publish({ ...state, headsInView: inView ? [...others, id] : others });
    },
  };
}

function rank(report: LiveReport): number {
  return (report.step ? 2 : 0) + (report.kind === 'lead' ? 0 : 1);
}

function shownFirst(a: LiveReport, b: LiveReport): boolean {
  return rank(a) > rank(b) || (rank(a) === rank(b) && a.since >= b.since);
}

export function latestWork(live: readonly LiveReport[]): LiveReport | null {
  const working = live.filter((report) => report.working);
  return working.reduce<LiveReport | null>(
    (latest, report) => (latest && shownFirst(latest, report) ? latest : report),
    null,
  );
}

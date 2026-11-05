import { useEffect, useState, useSyncExternalStore } from 'react';
import { isTerminalRunStatus, type Run, type TerminalRunStatus } from '@spark-outpost/contracts';
import { runSeconds } from '../turns.ts';
import { stepActivity, type StepActivity } from './step-activity.ts';
import { providerName } from '../provider-name.ts';
import { latestWork, type PendingEntry, type StatusStore, type Worker } from './status-store.ts';

export const DONE_SHOWN_MS = 8_000;
export const SLOW_STEP_MS = 10_000;

export type StatusLine =
  | { kind: 'waiting'; entries: readonly PendingEntry[] }
  | { kind: 'running'; worker: Worker; activity: StepActivity | null; since: number | null }
  | { kind: 'ended'; word: string; elapsed: number | null };

const ENDED_WORDS: Record<TerminalRunStatus, string> = {
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped',
  outcome_unknown: 'Interrupted',
};

interface StatusInput {
  store: StatusStore;
  runs: readonly Run[];
  activeRunId: string | null;
  provider: string;
}

function useEndedRun(runs: readonly Run[], activeRunId: string | null): Run | null {
  const [last, setLast] = useState(activeRunId);
  const [ended, setEnded] = useState<string | null>(null);
  if (activeRunId !== last) {
    setLast(activeRunId);
    setEnded(activeRunId === null ? last : null);
  }
  useEffect(() => {
    if (!ended) return;
    const timer = setTimeout(() => setEnded(null), DONE_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [ended]);
  const run = ended ? runs.find((candidate) => candidate.id === ended) : undefined;
  return run && isTerminalRunStatus(run.status) ? run : null;
}

export function useStatusLine({
  store,
  runs,
  activeRunId,
  provider,
}: StatusInput): StatusLine | null {
  const snapshot = useSyncExternalStore(store.subscribe, store.snapshot);
  const ended = useEndedRun(runs, activeRunId);
  if (snapshot.pending.length > 0) return { kind: 'waiting', entries: snapshot.pending };
  const work = latestWork(snapshot.live);
  if (work || activeRunId) {
    const step = work?.step ?? null;
    return {
      kind: 'running',
      worker: work ?? {
        id: activeRunId ?? '',
        name: providerName(provider) || 'The agent',
        provider,
        kind: 'agent',
      },
      activity: step ? stepActivity(step) : null,
      since: step ? work!.since : null,
    };
  }
  if (!ended || !isTerminalRunStatus(ended.status)) return null;
  const seconds = runSeconds(ended);
  return {
    kind: 'ended',
    word: ENDED_WORDS[ended.status],
    elapsed: seconds === null ? null : seconds * 1000,
  };
}

export function useHeadInView(store: StatusStore, id: string | null): boolean {
  return useSyncExternalStore(
    store.subscribe,
    () => id !== null && store.snapshot().headsInView.includes(id),
  );
}

export function useNow(ticking: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

export function useThrottled(value: string, gapMs: number, state = ''): string {
  const [shown, setShown] = useState({ value: '', state: '' });
  const [lastAt, setLastAt] = useState(0);
  useEffect(() => {
    if (value === shown.value) return;
    const wait = state === shown.state ? Math.max(0, lastAt + gapMs - Date.now()) : 0;
    const timer = setTimeout(() => {
      setShown({ value, state });
      setLastAt(Date.now());
    }, wait);
    return () => clearTimeout(timer);
  }, [value, state, shown, lastAt, gapMs]);
  return shown.value;
}

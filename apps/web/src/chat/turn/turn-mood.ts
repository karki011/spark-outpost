import { isTerminalRunStatus, type Run, type TerminalRunStatus } from '@spark-outpost/contracts';
import { timedOut, WAITED_LABEL } from '../approvals/timed-out.ts';
import type { LiveRunStatus } from '../run-projection.ts';

const LIVE_MOODS: Record<LiveRunStatus, string> = {
  connecting: 'working',
  running: 'working',
  succeeded: 'done',
  failed: 'hit a problem',
  cancelled: 'stopped',
};

const FINISHED_MOODS: Record<TerminalRunStatus, string> = {
  succeeded: 'done',
  failed: 'hit a problem',
  cancelled: 'stopped',
  outcome_unknown: 'interrupted',
};

interface MoodFacts {
  run: Run;
  live: LiveRunStatus;
  waiting: boolean;
  waitingText: string | null;
  started: boolean;
}

export function turnMood({ run, live, waiting, waitingText, started }: MoodFacts): string {
  if (timedOut(run.error)) return WAITED_LABEL;
  if (isTerminalRunStatus(run.status)) return FINISHED_MOODS[run.status];
  if (waiting) return 'waiting for you';
  if (waitingText) return waitingText;
  const mood = LIVE_MOODS[live];
  return mood === 'working' && !started ? 'thinking' : mood;
}

import type { ConversationDetail, Interruption, Run, RunChanges } from '@spark-outpost/contracts';

export const INTERRUPTED_TITLE = 'This turn was interrupted';
export const CONTINUE_LABEL = 'Continue from here';
export const START_FRESH_LABEL = 'Start fresh';

const CREW_BLOCK =
  "This turn ran as a crew of several agents, and Spark can't resume a crew part-way yet, so you can only start fresh.";

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

export function stoppedText(stoppedAt: string | null, now: Date = new Date()): string {
  if (!stoppedAt) return 'Spark Outpost stopped while this turn was running.';
  const at = new Date(stoppedAt);
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = sameDay(at, now)
    ? ''
    : ` on ${at.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  return `Spark Outpost stopped at ${time}${day} while this turn was running.`;
}

export function filesText(
  changes: Pick<RunChanges, 'files' | 'revertible'> | undefined,
): string | null {
  if (!changes) return null;
  const count = changes.files.length;
  if (count === 0) return changes.revertible ? 'No files changed so far.' : null;
  return `${count} ${count === 1 ? 'file' : 'files'} changed so far.`;
}

export function blockedText(interruption: Pick<Interruption, 'blocked'>): string | null {
  return interruption.blocked === 'crew' ? CREW_BLOCK : null;
}

export type Aftermath =
  | { kind: 'undecided' }
  | { kind: 'continued'; runId: string }
  | { kind: 'fresh' }
  | { kind: 'moved_on' };

export function aftermath(
  run: Pick<Run, 'id' | 'status' | 'interruptionChoice'>,
  detail: Pick<ConversationDetail, 'runs' | 'interruption'>,
): Aftermath | null {
  if (run.status !== 'outcome_unknown') return null;
  const continued = detail.runs.find((candidate) => candidate.continuesRunId === run.id);
  if (continued) return { kind: 'continued', runId: continued.id };
  if (run.interruptionChoice === 'fresh') return { kind: 'fresh' };
  return detail.interruption?.runId === run.id ? { kind: 'undecided' } : { kind: 'moved_on' };
}

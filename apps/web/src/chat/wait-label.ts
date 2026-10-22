import { waitedOn, waitingOnLabel, type BackgroundWait } from '@spark-outpost/contracts';
import { clock } from '../calendar/calendar-format.ts';

interface StepRun {
  step: string | null;
  waitingOn?: number | undefined;
  background?: BackgroundWait | undefined;
}

export function waitLabel(count: number, background?: BackgroundWait | null): string {
  return waitingOnLabel(count, background, clock);
}

export function waitedOnText(count: number, background?: BackgroundWait | null): string {
  return waitedOn(count, background, clock);
}

export function sleepingLine(wakesAt: number): string {
  return `Sleeping until ${clock(wakesAt)}`;
}

export function runStep(run: StepRun): string | null {
  const { waitingOn, background } = run;
  if (waitingOn && background?.wakesAt !== undefined) return waitLabel(waitingOn, background);
  return run.step;
}

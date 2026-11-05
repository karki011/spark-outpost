import type { ReactNode } from 'react';
import { friendlyStep, isSparkNote } from '@spark-outpost/contracts';
export type TurnState = 'working' | 'waiting' | 'done' | 'failed' | 'stopped';
import { viewSteps, type RunStep, type StepView } from './run-projection.ts';

export function StepName({ name }: { name: string }) {
  return friendlyStep(name)
    .split('`')
    .map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part));
}

export function stepCount(steps: readonly unknown[]): string {
  return `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`;
}

function currentStep(steps: readonly StepView[]): string | null {
  const own = steps.filter((candidate) => !candidate.subagent && !candidate.waits);
  const step = own.findLast((candidate) => candidate.status !== 'done') ?? own.at(-1);
  return step ? friendlyStep(step.name).replaceAll('`', '') : null;
}

export function turnHeading(
  steps: readonly StepView[],
  state: TurnState,
  seconds: number | null,
  open = true,
): string {
  if (state === 'done' && seconds) return `worked for ${seconds}s`;
  const current = state === 'working' && !open ? currentStep(steps) : null;
  return current ? `${current} · ${stepCount(steps)}` : stepCount(steps);
}

export function loggedSteps(steps: readonly RunStep[]): StepView[] {
  return viewSteps(steps).filter((step) => !isSparkNote(step.name));
}

export interface StepLog {
  open: boolean;
  runId: string | null;
  listId: string;
  views: StepView[];
  working: boolean;
  toggle(): void;
}

export function StepToggle({
  log,
  label,
}: {
  log: Pick<StepLog, 'open' | 'listId' | 'toggle'>;
  label: ReactNode;
}) {
  return (
    <button
      type="button"
      className="steps-head"
      aria-expanded={log.open}
      aria-controls={log.listId}
      onClick={log.toggle}
    >
      <svg className="chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M4.5 3 7.5 6l-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span className="lbl">{label}</span>
    </button>
  );
}

export function StepIcon({ step, working }: { step: StepView; working: boolean }) {
  if (step.status === 'done') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" role="img" aria-label="Done">
        <path d="m2.5 6.5 2.5 2.5 4.5-5" fill="none" stroke="var(--success)" strokeWidth="1.6" />
      </svg>
    );
  }
  if (step.status === 'failed') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" role="img" aria-label="Failed">
        <path d="m3 3 6 6m0-6-6 6" fill="none" stroke="var(--danger)" strokeWidth="1.6" />
      </svg>
    );
  }
  if (working) return <span className="spin" role="img" aria-label="In progress" />;
  return <span className="step-open" role="img" aria-label="Not finished" />;
}

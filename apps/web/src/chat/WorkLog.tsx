import { useId, useState } from 'react';
import { friendlyStep } from '@spark-outpost/contracts';
import type { TurnState } from './AiTurn.tsx';
import { viewSteps, type RunStep, type StepView } from './run-projection.ts';

function StepName({ name }: { name: string }) {
  return friendlyStep(name)
    .split('`')
    .map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part));
}

function stepCount(steps: readonly StepView[]): string {
  return `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`;
}

function currentStep(steps: readonly StepView[]): string | null {
  const step = steps.findLast((candidate) => candidate.status !== 'done') ?? steps.at(-1);
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

export interface StepLog {
  open: boolean;
  listId: string;
  views: StepView[];
  working: boolean;
  toggle(): void;
}

export function useStepLog(steps: readonly RunStep[], state: TurnState): StepLog | null {
  const working = state === 'working' || state === 'waiting';
  const [choice, setChoice] = useState<boolean | null>(null);
  const listId = useId();
  if (steps.length === 0) return null;
  const open = choice ?? false;
  return { open, listId, views: viewSteps(steps), working, toggle: () => setChoice(!open) };
}

export function StepToggle({ log, label }: { log: StepLog; label: string }) {
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

function StepIcon({ step, working }: { step: StepView; working: boolean }) {
  if (step.status === 'done') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" role="img" aria-label="Done">
        <path d="m2.5 6.5 2.5 2.5 4.5-5" fill="none" stroke="var(--accent)" strokeWidth="1.6" />
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

export function StepList({ log }: { log: StepLog }) {
  const [wasOpen, setWasOpen] = useState(log.open);
  const [closing, setClosing] = useState(false);
  if (wasOpen !== log.open) {
    setWasOpen(log.open);
    setClosing(!log.open);
  }
  return (
    <div
      className="steps-body"
      id={log.listId}
      inert={!log.open}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && !log.open) setClosing(false);
      }}
    >
      {(log.open || closing) && (
        <ul>
          {log.views.map((step, index) => (
            <li key={`${step.name}-${index}`}>
              <StepIcon step={step} working={log.working} />
              <span>
                <StepName name={step.name} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface WorkLogProps {
  steps: RunStep[];
  state: TurnState;
}

export function WorkLog({ steps, state }: WorkLogProps) {
  const log = useStepLog(steps, state);
  if (!log) return null;
  return (
    <div className={log.open ? 'steps open' : 'steps'}>
      <StepToggle log={log} label={stepCount(log.views)} />
      <StepList log={log} />
    </div>
  );
}

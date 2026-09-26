import { useId, useState } from 'react';
import type { TurnState } from './AiTurn.tsx';
import { viewSteps, type RunStep, type StepView } from './run-projection.ts';

interface WorkLogProps {
  steps: RunStep[];
  state: TurnState;
  seconds?: number | null;
}

function StepName({ name }: { name: string }) {
  return name
    .split('`')
    .map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part));
}

function heading(steps: StepView[], state: TurnState, seconds: number | null) {
  const count = `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`;
  if (state === 'working') return 'Working';
  if (state === 'waiting') return 'Waiting for you';
  if (state === 'stopped') return `Stopped after ${count}`;
  if (state === 'failed') return `Failed after ${count}`;
  return seconds ? `Worked for ${seconds}s` : count;
}

export function WorkLog({ steps, state, seconds = null }: WorkLogProps) {
  const working = state === 'working' || state === 'waiting';
  const [choice, setChoice] = useState<boolean | null>(null);
  const listId = useId();
  if (steps.length === 0) return null;
  const open = choice ?? working;
  const views = viewSteps(steps);

  return (
    <div className={open ? 'steps open' : 'steps'}>
      <button
        type="button"
        className="steps-head"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setChoice(!open)}
      >
        <svg className="chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4.5 3 7.5 6l-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="lbl">{heading(views, state, seconds)}</span>
      </button>
      {open && (
        <ul id={listId}>
          {views.map((step, index) => (
            <li key={`${step.name}-${index}`}>
              {step.status === 'done' ? (
                <svg width="12" height="12" viewBox="0 0 12 12" role="img" aria-label="Done">
                  <path
                    d="m2.5 6.5 2.5 2.5 4.5-5"
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="1.6"
                  />
                </svg>
              ) : step.status === 'failed' ? (
                <svg width="12" height="12" viewBox="0 0 12 12" role="img" aria-label="Failed">
                  <path d="m3 3 6 6m0-6-6 6" fill="none" stroke="var(--danger)" strokeWidth="1.6" />
                </svg>
              ) : working ? (
                <span className="spin" role="img" aria-label="In progress" />
              ) : (
                <span className="step-open" role="img" aria-label="Not finished" />
              )}
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

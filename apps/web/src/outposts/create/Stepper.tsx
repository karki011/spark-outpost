import { CheckIcon } from '../../ui/icons.tsx';

export const STEPS = ['Name', 'Chats', 'Review'] as const;

export function Stepper({ current }: { current: number }) {
  return (
    <ol className="op-steps" aria-label="Steps">
      {STEPS.map((label, index) => {
        const done = index < current;
        return (
          <li
            key={label}
            className={done ? 'done' : undefined}
            aria-current={index === current ? 'step' : undefined}
          >
            <span className="op-step-dot" aria-hidden="true">
              {done ? <CheckIcon className="op-step-check" /> : index + 1}
            </span>
            <span>
              <span className="sr-only">
                Step {index + 1} of {STEPS.length}:{' '}
              </span>
              {label}
              {done && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

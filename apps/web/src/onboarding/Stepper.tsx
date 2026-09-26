import { CheckIcon } from '../ui/icons.tsx';

interface StepperProps {
  steps: string[];
  current: number;
  isEnabled: (index: number) => boolean;
  onSelect: (index: number) => void;
}

export function Stepper({ steps, current, isEnabled, onSelect }: StepperProps) {
  return (
    <nav aria-label="Setup progress">
      <ol className="vsteps">
        {steps.map((label, index) => {
          const state = index === current ? 'cur' : index < current ? 'done' : '';
          return (
            <li key={label}>
              <button
                type="button"
                className={`vstep ${state}`}
                aria-label={`Step ${index + 1} of ${steps.length}: ${label}`}
                aria-current={index === current ? 'step' : undefined}
                disabled={!isEnabled(index)}
                onClick={() => onSelect(index)}
              >
                <span className="vstep-dot" aria-hidden="true">
                  {state === 'done' ? <CheckIcon className="vstep-check" /> : index + 1}
                </span>
                <span className="vstep-label">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

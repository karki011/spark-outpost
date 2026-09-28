import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

export interface SegmentedOption {
  id: string;
  label: ReactNode;
}

interface SegmentedProps {
  ariaLabel: string;
  options: SegmentedOption[];
  value: string;
  onChange: (id: string) => void;
}

const STEPS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function Segmented({ ariaLabel, options, value, onChange }: SegmentedProps) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.id === value),
  );
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const count = options.length;
    let next: number | null = null;
    if (event.key in STEPS) next = (index + STEPS[event.key]! + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    if (next === null || count === 0) return;
    event.preventDefault();
    const option = options[next]!;
    onChange(option.id);
    const radios = event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]');
    radios[next]?.focus();
  };
  return (
    <div
      className="seg"
      style={{ '--n': options.length } as CSSProperties}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      <span
        className="seg-ind"
        style={{ transform: `translateX(${index * 100}%)` }}
        aria-hidden="true"
      />
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          data-option={option.id}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

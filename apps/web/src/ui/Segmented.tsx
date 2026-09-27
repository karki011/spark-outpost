import type { CSSProperties, ReactNode } from 'react';

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

export function Segmented({ ariaLabel, options, value, onChange }: SegmentedProps) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.id === value),
  );
  return (
    <div
      className="seg"
      style={{ '--n': options.length } as CSSProperties}
      role="radiogroup"
      aria-label={ariaLabel}
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

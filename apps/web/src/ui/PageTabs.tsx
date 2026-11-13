import './page-tabs.css';
import { useRef } from 'react';

interface PageTabsProps {
  ariaLabel: string;
  options: readonly { id: string; label: string; count?: number | null }[];
  value: string;
  onChange: (id: string) => void;
}

export function PageTabs({ ariaLabel, options, value, onChange }: PageTabsProps) {
  const tabs = useRef(new Map<string, HTMLButtonElement>());
  const move = (step: number) => {
    const index = options.findIndex((option) => option.id === value);
    const next = options[(index + step + options.length) % options.length];
    if (!next) return;
    onChange(next.id);
    tabs.current.get(next.id)?.focus();
  };
  return (
    <div className="page-tabs" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.id}
          ref={(element) => {
            if (element) tabs.current.set(option.id, element);
            else tabs.current.delete(option.id);
          }}
          type="button"
          role="tab"
          aria-selected={option.id === value}
          tabIndex={option.id === value ? 0 : -1}
          className="page-tab"
          onClick={() => onChange(option.id)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') move(1);
            if (event.key === 'ArrowLeft') move(-1);
          }}
        >
          {option.label}
          {option.count != null && (
            <>
              {' '}
              <span className="page-tab-n">{option.count}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}

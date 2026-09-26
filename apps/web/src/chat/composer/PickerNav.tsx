import type { KeyboardEvent, ReactNode } from 'react';
import { motion } from 'motion/react';
import { reveal } from '../../ui/transitions.tsx';

export type PickerSection = 'model' | 'effort' | 'permission';

export interface PickerRow {
  id: PickerSection;
  label: string;
  value: ReactNode;
  disabled: boolean;
}

interface PickerNavProps {
  rows: PickerRow[];
  active: PickerSection;
  panelId: string;
  onSelect: (id: PickerSection) => void;
}

export function PickerNav({ rows, active, panelId, onSelect }: PickerNavProps) {
  const enabled = rows.filter((row) => !row.disabled);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const index = enabled.findIndex((row) => row.id === active);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = enabled[(index + step + enabled.length) % enabled.length];
    if (!next) return;
    onSelect(next.id);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-section="${next.id}"]`)?.focus();
  };
  return (
    <div
      className="pnav"
      role="tablist"
      aria-orientation="vertical"
      aria-label="Chat settings"
      onKeyDown={onKeyDown}
    >
      {rows.map((row) => {
        const selected = row.id === active;
        return (
          <button
            key={row.id}
            type="button"
            role="tab"
            data-section={row.id}
            aria-selected={selected}
            aria-controls={panelId}
            aria-disabled={row.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!row.disabled) onSelect(row.id);
            }}
          >
            {selected && (
              <motion.span
                layoutId="pnav-highlight"
                className="pnav-highlight"
                transition={reveal}
              />
            )}
            <span className="pnav-label">{row.label}</span>
            <span className="pnav-value">{row.value}</span>
          </button>
        );
      })}
    </div>
  );
}

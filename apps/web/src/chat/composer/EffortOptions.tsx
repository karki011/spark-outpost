import { motion } from 'motion/react';
import type { CapabilityOption } from '@spark-outpost/contracts';
import { reveal } from '../../ui/transitions.tsx';
import { effortNote } from './model-options.ts';

interface EffortOptionsProps {
  efforts: CapabilityOption[];
  selected: string | null;
  onSelect: (effort: string) => void;
}

export function EffortOptions({ efforts, selected, onSelect }: EffortOptionsProps) {
  if (efforts.length === 0) {
    return <p className="mempty">This model doesn't offer effort levels.</p>;
  }
  return (
    <div role="radiogroup" aria-label="Effort">
      {efforts.map((effort, index) => {
        const note = effortNote(effort);
        const checked = effort.id === selected;
        const filled = (index + 1) / efforts.length;
        return (
          <button
            key={effort.id}
            type="button"
            className="mopt eopt"
            role="radio"
            aria-checked={checked}
            onClick={() => onSelect(effort.id)}
          >
            <span className="ebar" aria-hidden="true">
              <motion.i
                initial={{ scaleY: 0 }}
                animate={{ scaleY: filled }}
                transition={{ ...reveal, delay: index * 0.04 }}
              />
            </span>
            <span>
              <b>{effort.label}</b>
              {note && <small title={note}>{note}</small>}
            </span>
            <Tick />
          </button>
        );
      })}
    </div>
  );
}

export function Tick() {
  return (
    <svg className="tick" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m5 12 5 5 9-10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

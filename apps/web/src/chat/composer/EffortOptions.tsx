import type { CapabilityOption } from '@spark-outpost/contracts';
import { TickIcon } from '../../ui/icons.tsx';
import { EffortMeter } from './EffortMeter.tsx';
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
      {efforts.map((effort) => {
        const note = effortNote(effort);
        const checked = effort.id === selected;
        return (
          <button
            key={effort.id}
            type="button"
            className="mopt eopt"
            role="radio"
            aria-checked={checked}
            onClick={() => onSelect(effort.id)}
          >
            <EffortMeter efforts={efforts} effort={effort.id} />
            <span>
              <b>{effort.label}</b>
              {note && <small title={note}>{note}</small>}
            </span>
            <TickIcon />
          </button>
        );
      })}
    </div>
  );
}

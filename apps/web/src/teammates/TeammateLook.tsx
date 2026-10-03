import { useId, useState } from 'react';
import type { TeammateFace as Face } from '@spark-outpost/contracts';
import { FacePicker } from './FacePicker.tsx';

interface TeammateLookProps {
  picked: Face | null;
  shown: Face;
  onChange: (face: Face | null) => void;
}

export function TeammateLook({ picked, shown, onChange }: TeammateLookProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="tm-look">
      <div className="tm-look-row">
        <span className="tm-look-note" id={`${id}-note`}>
          {picked ? 'You picked this blob.' : 'Its blob comes from its name.'}
        </span>
        {picked && (
          <button type="button" className="btn ghost sm" onClick={() => onChange(null)}>
            Use name
          </button>
        )}
        <button
          type="button"
          className="btn ghost sm"
          aria-expanded={open}
          aria-controls={`${id}-picker`}
          aria-describedby={`${id}-note`}
          onClick={() => setOpen(!open)}
        >
          Change look
        </button>
      </div>
      {open && (
        <div id={`${id}-picker`}>
          <FacePicker face={shown} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

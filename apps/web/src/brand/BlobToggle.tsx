import './blob-toggle.css';
import { useState } from 'react';
import { SCOUT_ANTENNA, SCOUT_BODY, SCOUT_SPARK } from './scout-shape.ts';

interface BlobToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
  describedBy?: string;
  disabled?: boolean;
}

export function BlobToggle({
  label,
  checked,
  onChange,
  id,
  describedBy,
  disabled = false,
}: BlobToggleProps) {
  const [touched, setTouched] = useState(false);
  return (
    <button
      id={id}
      type="button"
      role="switch"
      className={touched ? 'btog btog-live' : 'btog'}
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => {
        setTouched(true);
        onChange(!checked);
      }}
    >
      <span className="btog-track" aria-hidden="true">
        <span className="btog-thumb">
          <svg className="btog-blob" viewBox="0 0 64 64">
            <g className="btog-hop">
              <g className="btog-body">
                <path className="btog-ant" d={SCOUT_ANTENNA} />
                <path className="btog-spark" d={SCOUT_SPARK} />
                <path className="btog-skin" d={SCOUT_BODY} />
                <g className="btog-awake">
                  <path d="M22.4 40.5Q25.3 34.5 28.2 40.5M35.8 40.5Q38.7 34.5 41.6 40.5" />
                  <circle className="btog-cheek" cx="18.5" cy="46.5" r="2.7" />
                  <circle className="btog-cheek" cx="45.5" cy="46.5" r="2.7" />
                </g>
                <path
                  className="btog-asleep"
                  d="M22.4 38.5Q25.3 42 28.2 38.5M35.8 38.5Q38.7 42 41.6 38.5"
                />
              </g>
            </g>
          </svg>
          <span className="btog-z">z</span>
        </span>
      </span>
    </button>
  );
}

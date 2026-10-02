import { useId, type KeyboardEvent } from 'react';
import {
  TEAMMATE_COLORS,
  TEAMMATE_SHAPES,
  type TeammateFace as Face,
} from '@spark-outpost/contracts';
import { TeammateFace } from './TeammateFace.tsx';
import { COLOR_LABELS, SHAPE_LABELS } from './face-style.ts';

interface FacePickerProps {
  face: Face;
  onChange: (face: Face) => void;
}

function arrowStep<T>(event: KeyboardEvent, options: readonly T[], current: T): T | null {
  const delta =
    event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? -1
        : 0;
  if (delta === 0) return null;
  event.preventDefault();
  const index = options.indexOf(current);
  return options[(index + delta + options.length) % options.length]!;
}

function focusChecked(event: KeyboardEvent<HTMLElement>) {
  requestAnimationFrame(() =>
    event.currentTarget.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(),
  );
}

export function FacePicker({ face, onChange }: FacePickerProps) {
  const id = useId();
  return (
    <div className="tm-face-picker">
      <span className="tm-label" id={`${id}-shape`}>
        Blob
      </span>
      <div
        className="tm-shapes"
        role="radiogroup"
        aria-labelledby={`${id}-shape`}
        onKeyDown={(event) => {
          const next = arrowStep(event, TEAMMATE_SHAPES, face.shape);
          if (!next) return;
          onChange({ ...face, shape: next });
          focusChecked(event);
        }}
      >
        {TEAMMATE_SHAPES.map((shape) => (
          <button
            key={shape}
            type="button"
            role="radio"
            aria-checked={shape === face.shape}
            aria-label={SHAPE_LABELS[shape]}
            title={SHAPE_LABELS[shape]}
            tabIndex={shape === face.shape ? 0 : -1}
            className="tm-shape"
            onClick={() => onChange({ ...face, shape })}
          >
            <TeammateFace face={{ shape, color: face.color }} size={30} />
          </button>
        ))}
      </div>
      <span className="tm-label" id={`${id}-color`}>
        Colour
      </span>
      <div
        className="tm-colors"
        role="radiogroup"
        aria-labelledby={`${id}-color`}
        onKeyDown={(event) => {
          const next = arrowStep(event, TEAMMATE_COLORS, face.color);
          if (!next) return;
          onChange({ ...face, color: next });
          focusChecked(event);
        }}
      >
        {TEAMMATE_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={color === face.color}
            aria-label={COLOR_LABELS[color]}
            title={COLOR_LABELS[color]}
            tabIndex={color === face.color ? 0 : -1}
            className="tm-color"
            onClick={() => onChange({ ...face, color })}
          >
            <TeammateFace face={{ shape: 'round', color }} size={22} />
          </button>
        ))}
      </div>
    </div>
  );
}

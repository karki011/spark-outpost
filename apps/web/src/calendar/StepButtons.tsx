import { ChevronIcon } from '../ui/icons.tsx';

interface StepButtonsProps {
  unit: 'day' | 'month' | 'year';
  onStep: (delta: -1 | 1) => void;
}

export function StepButtons({ unit, onStep }: StepButtonsProps) {
  return (
    <>
      <button
        type="button"
        className="mo-step"
        aria-label={`Previous ${unit}`}
        onClick={() => onStep(-1)}
      >
        <span className="mo-back">
          <ChevronIcon />
        </span>
      </button>
      <button
        type="button"
        className="mo-step"
        aria-label={`Next ${unit}`}
        onClick={() => onStep(1)}
      >
        <ChevronIcon />
      </button>
    </>
  );
}

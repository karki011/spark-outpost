import './steer.css';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import type { SteerControl } from './use-steer.ts';

interface SteerTargetProps {
  control: SteerControl;
  ready: boolean;
  onSend: () => void;
}

export function SteerTarget({ control, ready, onSend }: SteerTargetProps) {
  return (
    <>
      <div className="steer-target">
        <ChoicePicker
          label="Steer to"
          choices={control.choices}
          value={control.target}
          onChange={control.onTarget}
        />
      </div>
      <button
        type="button"
        className="send steer-send"
        aria-label="Send to the pieces"
        disabled={!ready}
        onClick={onSend}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M8 13V3M3.5 7.5 8 3l4.5 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          />
        </svg>
      </button>
    </>
  );
}

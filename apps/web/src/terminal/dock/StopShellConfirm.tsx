import { useEffect, useId, useRef } from 'react';
import { HoldToConfirm } from '../../ui/HoldToConfirm.tsx';

interface StopShellConfirmProps {
  command: string;
  name: string;
  onStop: () => void;
  onKeep: () => void;
}

export function StopShellConfirm({ command, name, onStop, onKeep }: StopShellConfirmProps) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('.hold-btn')?.focus();
  }, []);

  return (
    <div
      ref={box}
      className="term-dock-confirm"
      role="group"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onKeep();
      }}
    >
      <div className="term-confirm-text">
        <p id={titleId} className="term-confirm-q">
          Stop <code>{command}</code>?
        </p>
        <p className="term-confirm-why">
          It’s still running in {name}. Closing the tab stops it and everything it started.
        </p>
      </div>
      <HoldToConfirm
        label="Hold to stop"
        hint="Press and hold for 1.5 seconds, with the mouse or Space."
        holdingHint="Keep holding. Let go now to cancel."
        releasedHint="Released early. It’s still running."
        adornment={
          <button type="button" className="btn line" onClick={onKeep}>
            Keep running
          </button>
        }
        onConfirm={onStop}
      />
    </div>
  );
}

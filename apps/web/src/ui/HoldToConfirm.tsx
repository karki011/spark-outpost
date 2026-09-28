import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import './hold-to-confirm.css';

const HOLD_KEYS = new Set([' ', 'Enter']);
const RING_LENGTH = 50.27;

type HoldPhase = 'idle' | 'holding' | 'done' | 'released';

interface HoldToConfirmProps {
  label: string;
  hint: string;
  holdingHint: string;
  releasedHint: string;
  holdMs?: number;
  disabled?: boolean;
  onConfirm: () => void;
}

export function HoldToConfirm({
  label,
  hint,
  holdingHint,
  releasedHint,
  holdMs = 1500,
  disabled = false,
  onConfirm,
}: HoldToConfirmProps) {
  const hintId = useId();
  const [phase, setPhase] = useState<HoldPhase>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmRef = useRef(onConfirm);

  useEffect(() => {
    confirmRef.current = onConfirm;
  }, [onConfirm]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const start = () => {
    if (disabled || timer.current) return;
    setPhase('holding');
    timer.current = setTimeout(() => {
      timer.current = null;
      setPhase('done');
      confirmRef.current();
    }, holdMs);
  };

  const release = () => {
    if (!timer.current) {
      setPhase((current) => (current === 'done' ? 'idle' : current));
      return;
    }
    clearTimeout(timer.current);
    timer.current = null;
    setPhase('released');
  };

  const status = phase === 'holding' ? holdingHint : phase === 'released' ? releasedHint : hint;

  return (
    <div className="hold">
      <button
        type="button"
        className="btn line hold-btn"
        data-phase={phase}
        disabled={disabled}
        aria-describedby={hintId}
        style={{ '--hold-ms': `${holdMs}ms` } as CSSProperties}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          start();
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onKeyDown={(event) => {
          if (!HOLD_KEYS.has(event.key)) return;
          event.preventDefault();
          if (!event.repeat) start();
        }}
        onKeyUp={(event) => {
          if (HOLD_KEYS.has(event.key)) release();
        }}
        onBlur={release}
        onContextMenu={(event) => event.preventDefault()}
      >
        <svg className="hold-ring" width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="8" className="hold-ring-bg" />
          <circle
            cx="10"
            cy="10"
            r="8"
            className="hold-ring-fg"
            style={{ strokeDasharray: RING_LENGTH }}
          />
        </svg>
        <span>{label}</span>
      </button>
      <p id={hintId} className="hold-hint" aria-live="polite">
        {status}
      </p>
    </div>
  );
}

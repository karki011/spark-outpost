import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import './hold-to-confirm.css';

const HOLD_KEYS = new Set([' ', 'Enter']);
const RING_LENGTH = 50.27;

export type HoldPhase = 'idle' | 'holding' | 'done' | 'released';

export interface HoldChange {
  phase: HoldPhase;
  progress: number;
}

interface HoldToConfirmProps {
  label: string;
  hint: string;
  holdingHint: string;
  releasedHint: string;
  holdMs?: number;
  disabled?: boolean;
  adornment?: ReactNode;
  onConfirm: () => void;
  onHoldChange?: (change: HoldChange) => void;
}

export function HoldToConfirm({
  label,
  hint,
  holdingHint,
  releasedHint,
  holdMs = 1500,
  disabled = false,
  adornment,
  onConfirm,
  onHoldChange,
}: HoldToConfirmProps) {
  const hintId = useId();
  const [phase, setPhase] = useState<HoldPhase>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef(0);
  const startedAt = useRef(0);
  const handlers = useRef({ onConfirm, onHoldChange });

  useEffect(() => {
    handlers.current = { onConfirm, onHoldChange };
  }, [onConfirm, onHoldChange]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      cancelAnimationFrame(frame.current);
    },
    [],
  );

  const progress = () => Math.min(1, (Date.now() - startedAt.current) / holdMs);

  const report = (next: HoldPhase, value: number) => {
    setPhase(next);
    handlers.current.onHoldChange?.({ phase: next, progress: value });
  };

  const track = () => {
    frame.current = requestAnimationFrame(() => {
      if (!timer.current) return;
      handlers.current.onHoldChange?.({ phase: 'holding', progress: progress() });
      track();
    });
  };

  const start = () => {
    if (disabled || timer.current) return;
    startedAt.current = Date.now();
    report('holding', 0);
    timer.current = setTimeout(() => {
      timer.current = null;
      cancelAnimationFrame(frame.current);
      report('done', 1);
      handlers.current.onConfirm();
    }, holdMs);
    if (onHoldChange) track();
  };

  const release = () => {
    if (!timer.current) {
      if (phase === 'done') report('idle', 0);
      return;
    }
    clearTimeout(timer.current);
    timer.current = null;
    cancelAnimationFrame(frame.current);
    report('released', progress());
  };

  const status = phase === 'holding' ? holdingHint : phase === 'released' ? releasedHint : hint;

  return (
    <div className="hold">
      <div className="hold-row">
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
        {adornment}
      </div>
      <p id={hintId} className="hold-hint" aria-live="polite">
        {status}
      </p>
    </div>
  );
}

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { reveal } from './transitions.tsx';
import './toast.css';
import './grace-period.css';

const TICK_MS = 200;

interface GracePeriodBarProps {
  text: string;
  announcement: string;
  seconds: number;
  onElapse: () => void;
  onUndo: () => void;
  decoration?: (secondsLeft: number) => ReactNode;
}

export function GracePeriodBar({
  text,
  announcement,
  seconds,
  onElapse,
  onUndo,
  decoration,
}: GracePeriodBarProps) {
  const [left, setLeft] = useState(seconds);
  const undoRef = useRef<HTMLButtonElement>(null);
  const handlers = useRef({ onElapse, onUndo });

  useEffect(() => {
    handlers.current = { onElapse, onUndo };
  }, [onElapse, onUndo]);

  useEffect(() => {
    const deadline = Date.now() + seconds * 1000;
    const elapse = setTimeout(() => handlers.current.onElapse(), seconds * 1000);
    const tick = setInterval(() => {
      setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, TICK_MS);
    return () => {
      clearTimeout(elapse);
      clearInterval(tick);
    };
  }, [seconds]);

  useEffect(() => {
    let focusTimer: ReturnType<typeof setTimeout> | undefined;
    const focusUndoAfterRelease = () => {
      focusTimer = setTimeout(() => undoRef.current?.focus(), 0);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      handlers.current.onUndo();
    };
    const release = { once: true, capture: true } as const;
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', focusUndoAfterRelease, release);
    window.addEventListener('pointerup', focusUndoAfterRelease, release);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', focusUndoAfterRelease, release);
      window.removeEventListener('pointerup', focusUndoAfterRelease, release);
    };
  }, []);

  return (
    <motion.div
      className="toast floating grace"
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, transition: { ...reveal, duration: 0.15 } }}
      transition={reveal}
    >
      <span className="sr-only" role="status">
        {announcement}
      </span>
      <span aria-hidden="true">{text}</span>
      <b className="grace-count" aria-hidden="true">
        {left}s
      </b>
      <button ref={undoRef} type="button" onClick={onUndo}>
        Undo
      </button>
      <i
        className="toast-timer"
        aria-hidden="true"
        style={
          { '--grace-ms': `${seconds * 1000}ms`, '--grace-left': left / seconds } as CSSProperties
        }
      />
      {decoration?.(left)}
    </motion.div>
  );
}

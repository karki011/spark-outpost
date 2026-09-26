import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { reveal } from '../ui/transitions.tsx';
import type { ShownToast, Toaster } from './use-toast.ts';

const TOAST_MS = 5000;
const AFTER_HOVER_MS = 1500;

interface ToastCardProps {
  toast: ShownToast;
  onDismiss: () => void;
  onUndo: () => void;
}

function ToastCard({ toast, onDismiss, onUndo }: ToastCardProps) {
  const [paused, setPaused] = useState(false);
  const [delay, setDelay] = useState(TOAST_MS);

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(onDismiss, delay);
    return () => clearTimeout(timer);
  }, [paused, delay, onDismiss]);

  const pause = () => setPaused(true);
  const resume = () => {
    setDelay(AFTER_HOVER_MS);
    setPaused(false);
  };

  return (
    <motion.div
      className="toast"
      role="status"
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, transition: { ...reveal, duration: 0.15 } }}
      transition={reveal}
      onPointerEnter={pause}
      onPointerLeave={resume}
      onFocus={pause}
      onBlur={resume}
    >
      <span>{toast.text}</span>
      {toast.undo && (
        <button type="button" onClick={onUndo}>
          Undo
        </button>
      )}
      <i className={`tbar${paused ? ' paused' : ''}`} aria-hidden="true" />
    </motion.div>
  );
}

export function ToastHost({ toaster }: { toaster: Toaster }) {
  const { toast, dismiss, undo } = toaster;
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence initial={false} mode="popLayout">
        {toast && <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} onUndo={undo} />}
      </AnimatePresence>
    </div>
  );
}

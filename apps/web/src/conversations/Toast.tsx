import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useIsPresent, type PanInfo, type Transition } from 'motion/react';
import { reveal } from '../ui/transitions.tsx';
import type { ShownToast, Toaster } from './use-toast.ts';
import '../ui/toast.css';

const TOAST_MS = 5000;
const AFTER_HOVER_MS = 1500;
const SWIPE_DISTANCE = 40;
const SWIPE_VELOCITY = 400;
const STACK_ID = 'toast-stack';

const morph: Transition = { type: 'spring', stiffness: 520, damping: 40, mass: 0.9 };

function useAutoDismiss(toastId: number, paused: boolean, onDismiss: () => void) {
  const [delay, setDelay] = useState(TOAST_MS);
  const [shownId, setShownId] = useState(toastId);

  if (shownId !== toastId) {
    setShownId(toastId);
    setDelay(TOAST_MS);
  }

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(onDismiss, delay);
    return () => clearTimeout(timer);
  }, [paused, delay, onDismiss, toastId]);

  return () => setDelay(AFTER_HOVER_MS);
}

interface ToastBodyProps {
  toast: ShownToast;
  onUndo: () => void;
  onRetry: () => void;
}

function ToastBody({ toast, onUndo, onRetry }: ToastBodyProps) {
  const present = useIsPresent();
  return (
    <motion.div
      className="toast-body"
      layout="position"
      inert={!present}
      aria-hidden={present ? undefined : true}
      initial={{ opacity: 0, y: 6, filter: 'blur(3px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: -6, filter: 'blur(3px)', transition: { duration: 0.12 } }}
      transition={reveal}
    >
      <span className="toast-text" title={toast.text}>
        {toast.text}
      </span>
      {toast.undo && (
        <button type="button" onClick={onUndo}>
          Undo
        </button>
      )}
      {toast.retry && (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      )}
    </motion.div>
  );
}

interface ToastPillProps {
  toast: ShownToast;
  onDismiss: () => void;
  onUndo: () => void;
  onRetry: () => void;
}

function ToastPill({ toast, onDismiss, onUndo, onRetry }: ToastPillProps) {
  const [paused, setPaused] = useState(false);
  const shortenDelay = useAutoDismiss(toast.id, paused, onDismiss);

  const pause = () => setPaused(true);
  const resume = () => {
    shortenDelay();
    setPaused(false);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onDismiss();
  };

  const onDragEnd = (_event: unknown, info: PanInfo) => {
    if (info.offset.x > SWIPE_DISTANCE || info.velocity.x > SWIPE_VELOCITY) onDismiss();
  };

  return (
    <motion.div
      className="toast"
      role="status"
      layout
      style={{ borderRadius: 22 }}
      initial={{ opacity: 0, y: -16, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, scale: 0.94, transition: { ...reveal, duration: 0.15 } }}
      transition={morph}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0.05, right: 0.6 }}
      onDragEnd={onDragEnd}
      onPointerEnter={pause}
      onPointerLeave={resume}
      onFocus={pause}
      onBlur={resume}
      onKeyDown={onKeyDown}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <ToastBody key={toast.id} toast={toast} onUndo={onUndo} onRetry={onRetry} />
      </AnimatePresence>
      <i key={toast.id} className={`toast-timer${paused ? ' paused' : ''}`} aria-hidden="true" />
    </motion.div>
  );
}

function toastStack() {
  const found = document.getElementById(STACK_ID);
  if (found) return found;
  const stack = document.createElement('div');
  stack.id = STACK_ID;
  stack.className = 'toast-stack';
  document.body.append(stack);
  return stack;
}

type Placement = 'pending' | 'modal' | 'page';

function usePlacement() {
  const anchor = useRef<HTMLSpanElement>(null);
  const [placement, setPlacement] = useState<Placement>('pending');
  useLayoutEffect(() => {
    setPlacement(anchor.current?.closest('[aria-modal="true"]') ? 'modal' : 'page');
  }, []);
  return { anchor, placement };
}

export function ToastHost({ toaster }: { toaster: Toaster }) {
  const { toast, dismiss, undo, retry } = toaster;
  const { anchor, placement } = usePlacement();
  const toasts = (
    <div className="toasts" aria-live="polite">
      <AnimatePresence initial={false}>
        {toast && (
          <ToastPill key="toast" toast={toast} onDismiss={dismiss} onUndo={undo} onRetry={retry} />
        )}
      </AnimatePresence>
    </div>
  );
  return (
    <>
      <span ref={anchor} hidden />
      {placement === 'modal' && <div className="toast-stack">{toasts}</div>}
      {placement === 'page' && createPortal(toasts, toastStack())}
    </>
  );
}

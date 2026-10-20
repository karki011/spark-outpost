import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../ui/motion.ts';

const LEAVE_MS = 320;
const FADE_MS = 120;

export function useLeave() {
  const reduced = useReducedMotion();
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const leave = (action: () => void) => {
    if (leaving) return;
    setLeaving(true);
    timer.current = setTimeout(
      () => {
        action();
        setLeaving(false);
      },
      reduced ? FADE_MS : LEAVE_MS,
    );
  };
  return { leaving, leave };
}

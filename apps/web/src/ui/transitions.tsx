import type { ReactNode } from 'react';
import { MotionConfig, type Transition } from 'motion/react';
import { useReducedMotion } from './motion.ts';

export const easeOut = [0.2, 0.8, 0.2, 1] as const;

export const reveal: Transition = { duration: 0.2, ease: easeOut };

export const slide: Transition = { duration: 0.25, ease: easeOut };

export const fadeReveal = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: reveal,
} as const;

const expand: Transition = {
  height: { duration: 0.34, ease: easeOut },
  opacity: { duration: 0.24, ease: easeOut },
};

export function useExpandReveal() {
  const reduced = useReducedMotion();
  return {
    initial: { height: 0, opacity: 0 },
    animate: { height: 'auto', opacity: 1 },
    exit: { height: 0, opacity: 0 },
    transition: reduced ? { height: { duration: 0 }, opacity: reveal } : expand,
  } as const;
}

export function AppMotion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

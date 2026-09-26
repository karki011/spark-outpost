import type { ReactNode } from 'react';
import { MotionConfig, type Transition } from 'motion/react';

export const easeOut = [0.2, 0.8, 0.2, 1] as const;

export const reveal: Transition = { duration: 0.2, ease: easeOut };

export const slide: Transition = { duration: 0.25, ease: easeOut };

export const fadeReveal = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: reveal,
} as const;

export function AppMotion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

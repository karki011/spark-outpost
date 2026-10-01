import { AnimatePresence, motion } from 'motion/react';
import { CheckIcon } from '../ui/icons.tsx';
import type { TestPhase } from './test-message.ts';
import './test-bubble.css';

const pop = {
  initial: { opacity: 0, scale: 0.6, x: -4 },
  animate: { opacity: 1, scale: 1, x: 0 },
  exit: { opacity: 0, scale: 0.8 },
  transition: { type: 'spring', stiffness: 520, damping: 26 },
} as const;

export function TestBubble({ phase }: { phase: TestPhase }) {
  return (
    <span className="test-bubble-slot" aria-hidden="true">
      <AnimatePresence initial={false}>
        {phase === 'asking' && (
          <motion.span key="asking" className="test-bubble" {...pop}>
            <i />
            <i />
            <i />
          </motion.span>
        )}
        {phase === 'answered' && (
          <motion.span key="answered" className="test-bubble answered" {...pop}>
            <CheckIcon />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

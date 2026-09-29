import { motion } from 'motion/react';
import { BlobScout, type ScoutMood } from '../brand/BlobScout.tsx';
import type { CheckMood } from './connect-check.ts';

const SCOUT_MOODS: Record<CheckMood, ScoutMood> = {
  checking: 'working',
  happy: 'happy',
  sad: 'sad',
  puzzled: null,
  neutral: null,
};

const arrive = { type: 'spring', stiffness: 380, damping: 20 } as const;

export function ConnectBlob({ mood }: { mood: CheckMood }) {
  return (
    <motion.span
      className="cb"
      data-mood={mood}
      aria-hidden="true"
      initial={{ opacity: 0, x: -32, scale: 0.5 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.15 } }}
      transition={arrive}
    >
      <span className="cb-walk">
        <span className="cb-body">
          <BlobScout size={40} mood={SCOUT_MOODS[mood]} />
        </span>
      </span>
      <svg className="cb-glass" viewBox="0 0 24 24">
        <circle cx="9" cy="9" r="6.5" />
        <path d="M14 14 21 21" />
      </svg>
      <span className="cb-mark">?</span>
      <span className="cb-burst">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
    </motion.span>
  );
}

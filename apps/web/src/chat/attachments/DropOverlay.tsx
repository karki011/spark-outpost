import './attachments.css';
import { AnimatePresence, motion } from 'motion/react';
import { reveal } from '../../ui/transitions.tsx';

export function DropOverlay({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="drop-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reveal}
        >
          <motion.div
            className="drop-card"
            initial={{ scale: 0.94 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.96 }}
            transition={reveal}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
            </svg>
            <strong>Drop files to attach</strong>
            <span>Images and text files</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

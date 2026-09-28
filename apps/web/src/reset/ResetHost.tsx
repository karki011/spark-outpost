import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { GracePeriodBar } from '../ui/GracePeriodBar.tsx';
import { reveal } from '../ui/transitions.tsx';
import { clearLocalAppData, saveResetNotice, takeResetNotice } from './local-data.ts';
import { resetSparkOutpost } from './reset-api.ts';
import { setResetState, useResetState } from './reset-store.ts';
import '../ui/toast.css';
import './reset.css';

export const GRACE_SECONDS = 10;

async function runReset(keepApiKeys: boolean): Promise<void> {
  setResetState({ phase: 'resetting' });
  try {
    const report = await resetSparkOutpost(keepApiKeys);
    clearLocalAppData();
    saveResetNotice(report.problems);
    window.location.reload();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Something went wrong.';
    setResetState({ phase: 'failed', message });
  }
}

function Notice({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <motion.div
      className="toast floating"
      role="alert"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={reveal}
    >
      <span>{text}</span>
      <button type="button" onClick={onDismiss}>
        Dismiss
      </button>
    </motion.div>
  );
}

export function ResetHost() {
  const state = useResetState();
  const [problems, setProblems] = useState(takeResetNotice);
  const idle = () => setResetState({ phase: 'idle' });

  return (
    <AnimatePresence>
      {state.phase === 'counting' && (
        <GracePeriodBar
          key="grace"
          text="Resetting Spark…"
          announcement={`Spark resets in ${GRACE_SECONDS} seconds. Press Undo or Escape to keep everything.`}
          seconds={GRACE_SECONDS}
          onElapse={() => void runReset(state.keepApiKeys)}
          onUndo={idle}
        />
      )}
      {state.phase === 'resetting' && (
        <motion.div key="busy" className="reset-busy" aria-busy="true" exit={{ opacity: 0 }}>
          <div className="toast floating" role="status">
            <span>Resetting Spark…</span>
            <i className="reset-skel" aria-hidden="true" />
          </div>
        </motion.div>
      )}
      {state.phase === 'failed' && (
        <Notice key="failed" text={`Spark couldn't reset: ${state.message}`} onDismiss={idle} />
      )}
      {state.phase === 'idle' && problems.length > 0 && (
        <Notice
          key="problems"
          text={`Spark was reset, but some things need a hand: ${problems.join(' ')}`}
          onDismiss={() => setProblems([])}
        />
      )}
    </AnimatePresence>
  );
}

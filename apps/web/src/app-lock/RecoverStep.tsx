import { useEffect, useRef } from 'react';
import { WarnIcon } from '../ui/icons.tsx';
import type { CodeRecovery } from './lock-recovery.ts';
import type { UnlockCopy } from './unlock-copy.ts';

export const RECOVER_TITLE = 'Reset your code?';

export function RecoverStep({
  copy,
  recovery,
  onCancel,
}: {
  copy: UnlockCopy;
  recovery: CodeRecovery;
  onCancel: () => void;
}) {
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirm.current?.focus();
  }, []);
  return (
    <div className="lock-entry">
      <button
        ref={confirm}
        type="button"
        className="btn primary"
        disabled={recovery.busy}
        onClick={recovery.run}
      >
        {copy.recoverButton}
      </button>
      <p className="lock-problem" role="alert">
        {recovery.problem && !recovery.busy && (
          <span>
            <WarnIcon />
            {recovery.problem}
          </span>
        )}
      </p>
      <button type="button" className="lock-link" disabled={recovery.busy} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

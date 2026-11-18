import type { ReactNode } from 'react';
import { LOCK_LABEL, useLockAction } from './use-lock-action.ts';

interface LockButtonProps {
  className: string;
  onlyWhenReady?: boolean;
  children: ReactNode;
}

export function LockButton({ className, onlyWhenReady = false, children }: LockButtonProps) {
  const action = useLockAction();
  if (!action || (onlyWhenReady && !action.ready)) return null;
  return (
    <button
      type="button"
      className={className}
      aria-label={LOCK_LABEL}
      aria-keyshortcuts={action.ready ? 'Shift+Meta+L' : undefined}
      title={action.title}
      onClick={action.run}
    >
      {children}
    </button>
  );
}

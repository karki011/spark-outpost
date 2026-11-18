import { requestSettings } from '../settings/settings-request.ts';
import { keysText } from '../ui/Keys.tsx';
import { appLock, useAppLock } from './use-app-lock.ts';

export const LOCK_LABEL = 'Lock Spark Outpost';

const SET_UP = 'Set up the privacy screen';

export interface LockAction {
  ready: boolean;
  title: string;
  run: () => void;
}

export function useLockAction(): LockAction | null {
  const lock = appLock();
  const status = useAppLock();
  if (!lock || !status) return null;
  const ready = status.enabled && status.hasCode;
  return {
    ready,
    title: ready ? `${LOCK_LABEL} · ${keysText(['⇧', '⌘', 'L'])}` : SET_UP,
    run: () => {
      if (ready) void lock.lockNow();
      else requestSettings('lock');
    },
  };
}

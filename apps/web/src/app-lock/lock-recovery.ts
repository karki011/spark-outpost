import { useEffect, useState } from 'react';
import type { AppLockRecovery, AppLockStatus, DesktopAppLock } from '../desktop/desktop-bridge.ts';
import { refreshAppLock } from './use-app-lock.ts';

export const RECOVERY_FAILED = 'Couldn’t confirm it’s you. Try again.';
export const CODE_RESET_NOTE =
  'Your code was reset. Set a new one to turn the privacy screen back on.';

const RESET_KEY = 'spark.app-lock.code-reset';
const resetListeners = new Set<() => void>();

export type RecoveryOutcome = 'recovered' | 'cancelled' | 'failed';

export function recoveryOutcome(result: AppLockRecovery): RecoveryOutcome {
  if (result.ok) return 'recovered';
  return result.reason === 'cancelled' ? 'cancelled' : 'failed';
}

export function canRecover(lock: DesktopAppLock, status: AppLockStatus): boolean {
  return status.recoveryAvailable === true && typeof lock.recover === 'function';
}

function readReset(): boolean {
  try {
    return localStorage.getItem(RESET_KEY) !== null;
  } catch {
    return false;
  }
}

function writeReset(on: boolean): void {
  try {
    if (on) localStorage.setItem(RESET_KEY, '1');
    else localStorage.removeItem(RESET_KEY);
  } catch {
    return;
  }
}

function markCodeReset(): void {
  writeReset(true);
  resetListeners.forEach((listener) => listener());
}

export function useCodeResetNote(): { shown: boolean; dismiss: () => void } {
  const [shown, setShown] = useState(readReset);
  useEffect(() => {
    const take = () => {
      if (!readReset()) return;
      writeReset(false);
      setShown(true);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === RESET_KEY) take();
    };
    writeReset(false);
    resetListeners.add(take);
    window.addEventListener('storage', onStorage);
    return () => {
      resetListeners.delete(take);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return { shown, dismiss: () => setShown(false) };
}

interface CodeRecoveryHandlers {
  onRecovered: () => void;
  onCancelled?: () => void;
}

export function useCodeRecovery(lock: DesktopAppLock | null, handlers: CodeRecoveryHandlers) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async () => {
    if (busy || !lock?.recover) return;
    setBusy(true);
    setProblem(null);
    try {
      const outcome = recoveryOutcome(await lock.recover());
      if (outcome === 'failed') setProblem(RECOVERY_FAILED);
      if (outcome === 'cancelled') handlers.onCancelled?.();
      if (outcome !== 'recovered') return;
      markCodeReset();
      await refreshAppLock();
      handlers.onRecovered();
    } catch {
      setProblem(RECOVERY_FAILED);
    } finally {
      setBusy(false);
    }
  };

  return { busy, problem, run: () => void run() };
}

export type CodeRecovery = ReturnType<typeof useCodeRecovery>;

import { useEffect, useRef, useState } from 'react';
import type { AppLockStatus, DesktopAppLock } from '../desktop/desktop-bridge.ts';
import { isFullCode } from './lock-code.ts';
import { useRetrySeconds } from './use-app-lock.ts';

const WRONG_CODE = 'Wrong code';
const CHECK_FAILED = 'Spark couldn’t check that. Try again.';
const REFUSAL_MS = 700;

export function useTouchUnlock(lock: DesktopAppLock, auto: boolean) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const asked = useRef(false);
  const running = useRef(false);

  const unlock = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setFailed(false);
    try {
      setFailed(!(await lock.unlockWithTouchId()));
    } catch {
      setFailed(true);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const unlockRef = useRef(unlock);
  useEffect(() => {
    unlockRef.current = unlock;
  });

  useEffect(() => {
    if (!auto) return;
    const askOnce = () => {
      if (asked.current || !document.hasFocus()) return;
      asked.current = true;
      void unlockRef.current();
    };
    askOnce();
    window.addEventListener('focus', askOnce);
    return () => window.removeEventListener('focus', askOnce);
  }, [auto]);

  return { busy, failed, unlock };
}

export type TouchUnlock = ReturnType<typeof useTouchUnlock>;

export function useCodeUnlock(lock: DesktopAppLock, status: AppLockStatus) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [misses, setMisses] = useState(0);
  const [refusing, setRefusing] = useState(false);
  const [answeredRetryAt, setAnsweredRetryAt] = useState<number | null>(null);
  const [seenStatus, setSeenStatus] = useState(status);
  if (seenStatus !== status) {
    setSeenStatus(status);
    setAnsweredRetryAt(null);
  }
  const wait = useRetrySeconds(status.retryAt ?? answeredRetryAt);
  const waiting = wait > 0;

  useEffect(() => {
    if (misses === 0) return;
    const timer = setTimeout(() => setRefusing(false), REFUSAL_MS);
    return () => clearTimeout(timer);
  }, [misses]);

  const miss = (message: string) => {
    setCode('');
    setProblem(message);
    setRefusing(true);
    setMisses((count) => count + 1);
  };

  const submit = async (full: string) => {
    if (busy || waiting) return;
    setBusy(true);
    try {
      const result = await lock.unlockWithCode(full);
      if (result.ok) return;
      setAnsweredRetryAt(result.retryAt);
      miss(WRONG_CODE);
    } catch {
      miss(CHECK_FAILED);
    } finally {
      setBusy(false);
    }
  };

  const type = (next: string) => {
    setCode(next);
    if (next !== '') setProblem(null);
    if (isFullCode(next)) void submit(next);
  };

  const submitTyped = () => {
    if (isFullCode(code)) void submit(code);
  };

  return { code, busy, problem, misses, refusing, wait, waiting, type, submitTyped };
}

export type CodeUnlock = ReturnType<typeof useCodeUnlock>;

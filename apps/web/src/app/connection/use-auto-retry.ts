import { useCallback, useEffect, useRef, useState } from 'react';
import { retryDelayMs } from './connection-failure.ts';

export interface RetryFailure {
  error: unknown;
  at: number;
}

export interface AutoRetry {
  secondsLeft: number;
  retrying: boolean;
  failedAttempts: number;
  lastFailure: RetryFailure | null;
  retryNow: () => void;
}

const secondsBefore = (failedAttempts: number) => retryDelayMs(failedAttempts) / 1000;

export function useAutoRetry(attempt: () => Promise<unknown>): AutoRetry {
  const attemptRef = useRef(attempt);
  const runningRef = useRef(false);
  const mountedRef = useRef(false);
  const failedRef = useRef(0);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(() => secondsBefore(0));
  const [retrying, setRetrying] = useState(false);
  const [lastFailure, setLastFailure] = useState<RetryFailure | null>(null);

  useEffect(() => {
    attemptRef.current = attempt;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRetrying(true);
    try {
      await attemptRef.current();
      runningRef.current = false;
      return;
    } catch (error) {
      runningRef.current = false;
      if (!mountedRef.current) return;
      setLastFailure({ error, at: Date.now() });
    }
    failedRef.current += 1;
    setFailedAttempts(failedRef.current);
    setSecondsLeft(secondsBefore(failedRef.current));
    setRetrying(false);
  }, []);

  useEffect(() => {
    if (retrying) return;
    const timer = setTimeout(() => {
      if (secondsLeft > 1) setSecondsLeft(secondsLeft - 1);
      else void run();
    }, 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft, retrying, run]);

  const retryNow = useCallback(() => void run(), [run]);

  return { secondsLeft, retrying, failedAttempts, lastFailure, retryNow };
}

export function reconnectLabel({ retrying, secondsLeft }: AutoRetry): string {
  return retrying ? 'Reconnecting…' : `Reconnecting in ${secondsLeft}s…`;
}

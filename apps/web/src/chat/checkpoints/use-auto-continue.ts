import { useCallback, useEffect, useState } from 'react';
import { approvalsApi } from '../../api/approvals.ts';
import { secondsLeft, type CheckpointApproval } from './checkpoint-model.ts';

export interface Countdown {
  optionId: string;
  seconds: number;
}

const TICK_MS = 500;

export function useAutoContinue(approval: CheckpointApproval): {
  countdown: Countdown | null;
  hold: () => void;
} {
  const [held, setHeld] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const option = approval.payload.checkpoint.autoOption;
  const at = approval.status === 'pending' && !held && option ? approval.autoContinueAt : null;

  useEffect(() => {
    if (!at) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [at]);

  const hold = useCallback(() => {
    if (!at) return;
    setHeld(true);
    void approvalsApi.hold(approval.id).catch(() => undefined);
  }, [at, approval.id]);

  const countdown = at && option ? { optionId: option, seconds: secondsLeft(at, now) } : null;
  return { countdown, hold };
}

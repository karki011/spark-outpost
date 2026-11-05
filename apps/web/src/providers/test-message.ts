import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProviderId, SetupState } from '@spark-outpost/contracts';
import { setupApi, setupKey } from '../api/setup.ts';

export type TestPhase = 'idle' | 'asking' | 'answered' | 'failed';

const REACTION_MS = 1600;

function lastTestOk(state: SetupState, providerId: ProviderId): boolean {
  const provider = state.providers.find((candidate) => candidate.id === providerId);
  return provider?.connection?.lastTest?.ok === true;
}

function useElapsedSeconds(startedAt: number | null): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (startedAt === null) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);
  if (startedAt === null) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

export interface TestMessage {
  phase: TestPhase;
  elapsedSeconds: number;
  error: string | null;
  send: (providerId: ProviderId) => void;
}

export function useTestMessage(): TestMessage {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<TestPhase>('idle');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const elapsedSeconds = useElapsedSeconds(phase === 'asking' ? startedAt : null);
  const mutation = useMutation({
    mutationFn: (providerId: ProviderId) => setupApi.sendTestMessage(providerId),
    onMutate: () => {
      setStartedAt(Date.now());
      setPhase('asking');
    },
    onSuccess: (state, providerId) => {
      queryClient.setQueryData(setupKey, state);
      setPhase(lastTestOk(state, providerId) ? 'answered' : 'failed');
    },
    onError: () => setPhase('failed'),
  });

  useEffect(() => {
    if (phase !== 'answered' && phase !== 'failed') return;
    const timeout = setTimeout(() => setPhase('idle'), REACTION_MS);
    return () => clearTimeout(timeout);
  }, [phase]);

  return {
    phase,
    elapsedSeconds,
    error: mutation.isError ? mutation.error.message : null,
    send: (providerId) => mutation.mutate(providerId),
  };
}

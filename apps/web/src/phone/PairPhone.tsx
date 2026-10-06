import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PairingStart, PendingPairing, TailscaleState } from '@spark-outpost/contracts';
import { usePageHidden } from '../ui/use-page-hidden.ts';
import { ENDING_REASONS, pairStage, type PairEnding } from './pair-flow.ts';
import { PairScene } from './PairScene.tsx';
import { phoneApi, phoneKeys } from './phone-api.ts';

const POLL_MS = 1500;
const TICK_MS = 1000;
const PAIRED_MOMENT_MS = 2600;

function useNow(running: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

interface PairPhoneProps {
  tailscale: TailscaleState;
  onPaired: () => void;
}

export function PairPhone({ tailscale, onPaired }: PairPhoneProps) {
  const queryClient = useQueryClient();
  const hidden = usePageHidden();
  const on = tailscale.status === 'on';
  const [started, setStarted] = useState<PairingStart | null>(null);
  const [paired, setPaired] = useState<string | null>(null);
  const [ended, setEnded] = useState<{ ending: PairEnding; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pairings = useQuery({
    queryKey: phoneKeys.pairings,
    queryFn: phoneApi.pairings,
    enabled: on,
    refetchInterval: on && !hidden ? POLL_MS : false,
  });
  const now = useNow(started !== null && !hidden);
  const stage = pairStage({
    status: tailscale.status,
    started,
    pending: pairings.data ?? [],
    paired,
    ended,
    now,
  });

  const start = useMutation({
    mutationFn: phoneApi.startPairing,
    onMutate: () => setError(null),
    onSuccess: (pairing) => {
      setEnded(null);
      setStarted(pairing);
    },
    onError: (failure) => {
      setStarted(null);
      setEnded({ ending: 'failed', reason: `${ENDING_REASONS.failed} ${messageOf(failure)}` });
    },
  });

  const answer = useMutation({
    mutationFn: ({ request, to }: { request: PendingPairing; to: 'confirm' | 'deny' }) =>
      phoneApi.answerPairing(request.id, to),
    onMutate: () => setError(null),
    onSuccess: (pending, { request, to }) => {
      queryClient.setQueryData(phoneKeys.pairings, pending);
      setStarted(null);
      if (to === 'deny') {
        setEnded({ ending: 'denied', reason: ENDING_REASONS.denied });
        return;
      }
      setPaired(request.deviceName);
      onPaired();
    },
    onError: (failure) => {
      setError(messageOf(failure));
      void queryClient.invalidateQueries({ queryKey: phoneKeys.pairings });
    },
  });

  useEffect(() => {
    if (paired === null) return;
    const timer = setTimeout(() => setPaired(null), PAIRED_MOMENT_MS);
    return () => clearTimeout(timer);
  }, [paired]);

  return (
    <section className="ph-card" aria-labelledby="ph-pair-title">
      <h2 id="ph-pair-title">Pair a phone</h2>
      <PairScene
        stage={stage}
        hostname={tailscale.hostname}
        busy={start.isPending || answer.isPending}
        error={error}
        onStart={() => start.mutate()}
        onAnswer={(request, to) => answer.mutate({ request, to })}
      />
    </section>
  );
}

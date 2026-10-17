import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useQueryClient } from '@tanstack/react-query';
import type { ConnectableId, ConnectionMethod } from '@spark-outpost/contracts';
import { ApiError, queryKeys } from '../api/client.ts';
import { setupApi, setupKey } from '../api/setup.ts';
import { GracePeriodBar } from '../ui/GracePeriodBar.tsx';
import { HoldToConfirm } from '../ui/HoldToConfirm.tsx';

const GRACE_SECONDS = 10;

function useGracefulDisconnect(providerId: ConnectableId, onRefused: () => void) {
  const queryClient = useQueryClient();
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waitingRef = useRef(false);
  const refused = useRef(onRefused);

  useEffect(() => {
    waitingRef.current = waiting;
    refused.current = onRefused;
  });

  const disconnect = async () => {
    try {
      queryClient.setQueryData(setupKey, await setupApi.disconnect(providerId));
      void queryClient.invalidateQueries({ queryKey: queryKeys.planUsage, exact: true });
      setError(null);
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setError(failure.message);
      refused.current();
    }
  };

  const disconnectRef = useRef(disconnect);

  useEffect(() => {
    disconnectRef.current = disconnect;
  });

  useEffect(
    () => () => {
      if (waitingRef.current) void disconnectRef.current();
    },
    [],
  );

  return {
    waiting,
    error,
    start: () => {
      setError(null);
      setWaiting(true);
    },
    undo: () => setWaiting(false),
    commit: () => {
      waitingRef.current = false;
      setWaiting(false);
      void disconnect();
    },
  };
}

interface DangerZoneProps {
  providerId: ConnectableId;
  name: string;
  method: ConnectionMethod;
  onRefused: () => void;
}

export function DangerZone({ providerId, name, method, onRefused }: DangerZoneProps) {
  const leave = useGracefulDisconnect(providerId, onRefused);
  const isKey = method === 'api_key';
  const action = isKey ? `remove the ${name} key` : `disconnect ${name}`;
  return (
    <>
      <HoldToConfirm
        label={isKey ? `Hold to remove the ${name} key` : `Hold to disconnect ${name}`}
        hint={
          isKey
            ? `Deletes the saved key and disconnects ${name}. You get ${GRACE_SECONDS} seconds to undo.`
            : `Spark stops using ${name}. Your CLI login stays. You get ${GRACE_SECONDS} seconds to undo.`
        }
        holdingHint="Keep holding. Let go now to cancel."
        releasedHint="Released early. Nothing happened."
        disabled={leave.waiting}
        onConfirm={leave.start}
      />
      {leave.error && (
        <p className="hintline bad" role="alert">
          {leave.error}
        </p>
      )}
      <AnimatePresence>
        {leave.waiting && (
          <GracePeriodBar
            key="grace"
            text={isKey ? `Removing the ${name} key…` : `Disconnecting ${name}…`}
            announcement={`Spark will ${action} in ${GRACE_SECONDS} seconds. Press Undo or Escape to keep it.`}
            seconds={GRACE_SECONDS}
            onElapse={leave.commit}
            onUndo={leave.undo}
          />
        )}
      </AnimatePresence>
    </>
  );
}

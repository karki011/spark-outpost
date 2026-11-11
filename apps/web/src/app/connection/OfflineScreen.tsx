import { useCallback, useEffect, useRef, useState } from 'react';
import { BlobScout } from '../../brand/BlobScout.tsx';
import { usePageHidden } from '../../ui/use-page-hidden.ts';
import { prefersReducedMotion, useReducedMotion } from '../../ui/motion.ts';
import { backOnlineBody, isMacUnreachable, offlineCopy, wakeHelp } from './connection-copy.ts';
import { describeFailure } from './connection-failure.ts';
import { markConnectionLost } from './connection-store.ts';
import { FailureDetails } from './FailureDetails.tsx';
import { OfflineCrew } from './OfflineCrew.tsx';
import { rememberedRemoteClient } from './remote-hint.ts';
import { reconnectLabel, useAutoRetry } from './use-auto-retry.ts';
import './connection.css';
import './offline-crew.css';

const CELEBRATE_MS = 1400;
const STILL_CELEBRATE_MS = 600;
const STARTLED_MS = 900;

interface OfflineScreenProps<T> {
  error: unknown;
  failedAt: number;
  onRetry: () => Promise<T>;
  onBack: (result: T) => void;
}

function attemptsLabel(failedAttempts: number): string {
  if (failedAttempts === 0) return '';
  return `Tried ${failedAttempts} ${failedAttempts === 1 ? 'time' : 'times'}. Still waiting.`;
}

function useStartled() {
  const [startled, setStartled] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const startle = useCallback(() => {
    setStartled(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStartled(false), STARTLED_MS);
  }, []);
  return { startled, startle };
}

export function OfflineScreen<T>({ error, failedAt, onRetry, onBack }: OfflineScreenProps<T>) {
  const [back, setBack] = useState(false);
  const still = useReducedMotion();
  const hidden = usePageHidden();
  const { startled, startle } = useStartled();
  const retry = useAutoRetry(async () => {
    const result = await onRetry();
    setBack(true);
    setTimeout(() => onBack(result), prefersReducedMotion() ? STILL_CELEBRATE_MS : CELEBRATE_MS);
  });
  const failure = describeFailure(retry.lastFailure?.error ?? error);
  const [remote] = useState(rememberedRemoteClient);
  const copy = offlineCopy(failure.kind, remote);
  const help = back ? '' : wakeHelp(failure.kind, remote, retry.failedAttempts);
  const mood = back ? 'happy' : startled ? 'alert' : copy.mood;

  useEffect(() => markConnectionLost(), []);

  return (
    <main
      className={`offline ${failure.kind}${back ? ' back' : ''}`}
      aria-labelledby="offline-title"
    >
      <div className="offline-card">
        <div className="offline-stage">
          <OfflineCrew back={back} still={still} paused={hidden} onPoke={startle} />
          <div className={`offline-blob${startled ? ' poked' : ''}`} aria-hidden="true">
            <BlobScout size={104} mood={mood} />
            {back ? null : failure.kind === 'unreachable' ? (
              <span className="offline-zz">
                <i>z</i>
                <i>z</i>
                <i>z</i>
              </span>
            ) : (
              <span className="offline-stars">
                <i />
                <i />
                <i />
              </span>
            )}
          </div>
        </div>
        <h1 id="offline-title">{back ? 'Back online!' : copy.title}</h1>
        <p className="offline-body">{back ? backOnlineBody(remote) : copy.body}</p>
        <div className="offline-retry" hidden={back}>
          <span className="offline-count">
            {retry.retrying && <span className="spin" aria-hidden="true" />}
            {reconnectLabel(retry)}
          </span>
          <button
            type="button"
            className="btn primary sm"
            onClick={retry.retryNow}
            disabled={retry.retrying}
          >
            Try now
          </button>
        </div>
        <p className="offline-tries" role="status">
          {back ? 'Back online!' : attemptsLabel(retry.failedAttempts)}
        </p>
        {help && (
          <p className="offline-help" role="status">
            {help}
          </p>
        )}
        {!back && (
          <FailureDetails
            failure={failure}
            failedAt={retry.lastFailure?.at ?? failedAt}
            showRestartHint={!isMacUnreachable(failure.kind, remote)}
          />
        )}
      </div>
    </main>
  );
}

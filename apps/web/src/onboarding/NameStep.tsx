import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setupApi, setupKey } from '../api/setup.ts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { UserBlob } from '../brand/UserBlob.tsx';
import { useReducedMotion } from '../ui/motion.ts';

const NAME_SAVE_DELAY_MS = 300;
const DRIFT_COUNT = 10;

interface NameStepProps {
  displayName: string;
  onDisplayNameChange: (value: string) => void;
  onEnter: () => void;
}

export function NameStep({ displayName, onDisplayNameChange, onEnter }: NameStepProps) {
  const queryClient = useQueryClient();
  const reducedMotion = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const [scoutHappy, setScoutHappy] = useState(false);
  const wasEmpty = useRef(displayName.trim() === '');
  const saveTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingName = useRef<string | null>(null);

  const mutation = useMutation({
    mutationFn: (name: string) => setupApi.updateProfile({ displayName: name }),
    onSuccess: (state) => queryClient.setQueryData(setupKey, state),
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const timeout = saveTimeout;
    const pending = pendingName;
    return () => {
      clearTimeout(timeout.current);
      if (pending.current === null) return;
      void setupApi
        .updateProfile({ displayName: pending.current })
        .then((state) => queryClient.setQueryData(setupKey, state));
    };
  }, [queryClient]);

  function handleChange(value: string) {
    onDisplayNameChange(value);
    const isEmpty = value.trim() === '';
    if (wasEmpty.current && !isEmpty) {
      setScoutHappy(true);
      setTimeout(() => setScoutHappy(false), 1600);
    }
    wasEmpty.current = isEmpty;
    clearTimeout(saveTimeout.current);
    pendingName.current = value;
    saveTimeout.current = setTimeout(() => {
      pendingName.current = null;
      mutation.mutate(value);
    }, NAME_SAVE_DELAY_MS);
  }

  const trimmed = displayName.trim();
  const firstName = trimmed.split(/\s+/)[0] ?? '';

  return (
    <>
      {!reducedMotion && (
        <div className="drifts" aria-hidden="true">
          {Array.from({ length: DRIFT_COUNT }, (_, index) => (
            <i
              key={index}
              className="drift"
              style={{
                left: `${6 + index * 9.5}%`,
                animationDelay: `${(index * 1.3) % 10}s`,
                animationDuration: `${9 + (index % 4)}s`,
              }}
            />
          ))}
        </div>
      )}
      <BlobScout size={76} mood={scoutHappy ? 'happy' : null} lookAtPointer />
      <h1 id="onbTitle">Welcome to Spark Outpost</h1>
      <p className="lede">
        Your base camp for building with AI agents. Setup takes about two minutes.
      </p>
      <label className="field">
        <span>What should we call you?</span>
        <input
          ref={inputRef}
          className="inp big"
          value={displayName}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onEnter();
            }
          }}
          placeholder="Your name"
          autoComplete="given-name"
          maxLength={40}
        />
      </label>
      <div className={`greet${trimmed ? ' in' : ''}`}>
        {trimmed ? (
          <>
            <UserBlob displayName={displayName} size={44} animate="always" />
            <p>
              Nice to meet you, <b>{firstName}</b>. This little one is you. It's made from your
              name. Next, let's connect an AI.
            </p>
          </>
        ) : (
          <p style={{ color: 'var(--faint)' }}>This is how you'll appear in chats.</p>
        )}
      </div>
    </>
  );
}

import '../ui/controls.css';
import './app-lock.css';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { AppLockStatus, DesktopAppLock } from '../desktop/desktop-bridge.ts';
import { WarnIcon } from '../ui/icons.tsx';
import { CodeBoxes } from './CodeBoxes.tsx';
import { isFullCode } from './lock-code.ts';
import { LockBlob } from './LockBlob.tsx';
import {
  useCodeUnlock,
  useTouchUnlock,
  type CodeUnlock,
  type TouchUnlock,
} from './use-lock-entry.ts';

const TOUCH_FAILED = 'Touch ID didn’t unlock Spark. Try again or enter your code.';

interface LockOverlayProps {
  lock: DesktopAppLock;
  status: AppLockStatus;
  opened: boolean;
}

function TouchEntry({ touch, onUseCode }: { touch: TouchUnlock; onUseCode: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    button.current?.focus();
  }, []);
  return (
    <div className="lock-entry">
      <button
        ref={button}
        type="button"
        className="btn primary"
        disabled={touch.busy}
        onClick={() => void touch.unlock()}
      >
        Unlock with Touch ID
      </button>
      <p className="lock-note" role="status">
        {touch.failed && !touch.busy ? TOUCH_FAILED : ''}
      </p>
      <button type="button" className="lock-link" onClick={onUseCode}>
        Enter code instead
      </button>
    </div>
  );
}

function CodeEntry({ entry, onUseTouch }: { entry: CodeUnlock; onUseTouch: (() => void) | null }) {
  const ids = useId();
  const input = useRef<HTMLInputElement>(null);
  const { code, busy, problem, misses, wait, waiting } = entry;

  useEffect(() => {
    if (!waiting) input.current?.focus();
  }, [waiting]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    entry.submitTyped();
  };

  return (
    <form className="lock-entry" onSubmit={onSubmit}>
      <label className="lock-label" htmlFor={`${ids}code`}>
        Enter your code
      </label>
      <CodeBoxes
        id={`${ids}code`}
        inputRef={input}
        value={code}
        onChange={entry.type}
        disabled={waiting}
        invalid={problem !== null}
        describedBy={`${ids}problem ${ids}wait`}
        shakes={misses}
      />
      <p id={`${ids}problem`} className="lock-problem" role="alert">
        {problem && (
          <span key={misses}>
            <WarnIcon />
            {problem}
          </span>
        )}
      </p>
      <p id={`${ids}wait`} className="lock-note">
        {waiting ? `Try again in ${wait} s` : ''}
      </p>
      <button type="submit" className="btn primary" disabled={!isFullCode(code) || busy || waiting}>
        Unlock
      </button>
      {onUseTouch && (
        <button type="button" className="lock-link" onClick={onUseTouch}>
          Use Touch ID
        </button>
      )}
    </form>
  );
}

export function LockOverlay({ lock, status, opened }: LockOverlayProps) {
  const ids = useId();
  const canTouch = status.touchId && status.touchIdAvailable;
  const [wantsCode, setWantsCode] = useState(false);
  const showCode = wantsCode || !canTouch;
  const touch = useTouchUnlock(lock, !showCode && !opened);
  const entry = useCodeUnlock(lock, status);
  return (
    <div
      className="lock-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${ids}title`}
      aria-describedby={`${ids}line`}
    >
      <LockBlob
        misses={entry.misses}
        moment={{
          opened,
          refusing: showCode && entry.refusing,
          waiting: showCode && entry.waiting,
          asking: !showCode && touch.busy,
          digits: showCode ? entry.code.length : 0,
        }}
      />
      <h1 id={`${ids}title`} className="lock-title">
        Spark Outpost is locked
      </h1>
      <p id={`${ids}line`} className="lock-line">
        Your chats keep running.
      </p>
      <div className="lock-entry-slot" inert={opened}>
        {showCode ? (
          <CodeEntry entry={entry} onUseTouch={canTouch ? () => setWantsCode(false) : null} />
        ) : (
          <TouchEntry touch={touch} onUseCode={() => setWantsCode(true)} />
        )}
      </div>
    </div>
  );
}

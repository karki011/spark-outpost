import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppLockStatus } from '../desktop/desktop-bridge.ts';
import { LOCK_HOST_CLASS, coverPage } from './lock-guard.ts';
import { LockOverlay } from './LockOverlay.tsx';
import { requestSettings } from '../settings/settings-request.ts';
import { appLock } from './use-app-lock.ts';

const OPENED_MS = 500;

function useOpenedMoment(status: AppLockStatus | null) {
  const locked = status?.locked === true;
  const [last, setLast] = useState<AppLockStatus | null>(null);
  const [leaving, setLeaving] = useState(false);
  if (locked && last !== status) {
    setLast(status);
    if (leaving) setLeaving(false);
  }
  if (!locked && last && !leaving) setLeaving(true);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => {
      setLeaving(false);
      setLast(null);
    }, OPENED_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  return { shown: locked ? status : leaving ? last : null, opened: !locked && leaving };
}

export function AppLockCover({ status }: { status: AppLockStatus | null }) {
  const lock = appLock();
  const pending = status === null && lock?.initiallyLocked !== false;
  const { shown, opened } = useOpenedMoment(status);
  const locked = shown !== null;

  useLayoutEffect(() => {
    if (locked) return coverPage();
    if (!pending) return;
    document.body.dataset.appLock = 'pending';
    return () => {
      delete document.body.dataset.appLock;
    };
  }, [locked, pending]);

  const recovered = useRef(false);
  useEffect(() => {
    if (locked || !recovered.current) return;
    recovered.current = false;
    requestSettings('lock');
  }, [locked]);

  if (!lock || !shown) return null;
  return createPortal(
    <div className={LOCK_HOST_CLASS}>
      <LockOverlay
        lock={lock}
        status={shown}
        opened={opened}
        onRecovered={() => {
          recovered.current = true;
        }}
      />
    </div>,
    document.body,
  );
}

import { useCallback, useSyncExternalStore } from 'react';
import {
  sparkDesktop,
  type AppLockPatch,
  type AppLockStatus,
  type DesktopAppLock,
} from '../desktop/desktop-bridge.ts';
import { retrySeconds } from './lock-code.ts';

const TICK_MS = 250;

let current: AppLockStatus | null = null;
let following = false;
const listeners = new Set<() => void>();

export function appLock(): DesktopAppLock | null {
  return sparkDesktop()?.lock ?? null;
}

function publish(next: AppLockStatus): void {
  current = next;
  listeners.forEach((listener) => listener());
}

function follow(): void {
  const lock = appLock();
  if (following || !lock) return;
  following = true;
  lock.onChange(publish);
  void lock.status().then((status) => {
    if (current === null) publish(status);
  });
}

function subscribe(listener: () => void): () => void {
  follow();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): AppLockStatus | null {
  return current;
}

export function useAppLock(): AppLockStatus | null {
  return useSyncExternalStore(subscribe, snapshot);
}

export async function updateAppLock(patch: AppLockPatch): Promise<void> {
  const lock = appLock();
  if (lock) publish(await lock.set(patch));
}

export async function refreshAppLock(): Promise<void> {
  const lock = appLock();
  if (lock) publish(await lock.status());
}

export function useRetrySeconds(retryAt: number | null): number {
  const tick = useCallback(
    (notify: () => void) => {
      if (retryAt === null) return () => undefined;
      const timer = setInterval(notify, TICK_MS);
      return () => clearInterval(timer);
    },
    [retryAt],
  );
  return useSyncExternalStore(tick, () => retrySeconds(retryAt, Date.now()));
}

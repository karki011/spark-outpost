export interface AppLockView {
  locked: boolean;
  available: boolean;
  hideNotifications: boolean;
}

export interface AppLockGate {
  locked(): boolean;
  available(): boolean;
  hidesNotices(): boolean;
  onLockedChange(listener: (locked: boolean) => void): () => void;
  onChange(listener: () => void): () => void;
  lockNow(): void;
  publish(view: AppLockView): void;
  serve(lockNow: (() => void) | null): void;
}

const OPEN: AppLockView = { locked: false, available: false, hideNotifications: true };

function tellAll<T>(listeners: ReadonlySet<(value: T) => void>, value: T): void {
  for (const listener of [...listeners]) {
    try {
      listener(value);
    } catch (error) {
      console.error(`[lock] A listener failed: ${error instanceof Error ? error.message : error}`);
    }
  }
}

export function createAppLockGate(): AppLockGate {
  let view = OPEN;
  let request: (() => void) | null = null;
  const lockedListeners = new Set<(locked: boolean) => void>();
  const changeListeners = new Set<(value: undefined) => void>();

  return {
    locked: () => view.locked,
    available: () => view.available,
    hidesNotices: () => view.locked && view.hideNotifications,
    onLockedChange(listener) {
      lockedListeners.add(listener);
      return () => void lockedListeners.delete(listener);
    },
    onChange(listener) {
      changeListeners.add(listener);
      return () => void changeListeners.delete(listener);
    },
    lockNow: () => request?.(),
    publish(next) {
      const before = view;
      if (JSON.stringify(before) === JSON.stringify(next)) return;
      view = { ...next };
      if (before.locked !== next.locked) tellAll(lockedListeners, next.locked);
      tellAll(changeListeners, undefined);
    },
    serve(lockNow) {
      request = lockNow;
    },
  };
}

export const appLockGate = createAppLockGate();

import {
  afterWrongCode,
  codeRefused,
  isLockCode,
  lockedState,
  locksOnSleep,
  locksWhenIdle,
  parseAppLockPatch,
  recoveredState,
  patchedSettings,
  startingState,
  statusOf,
  unlockedState,
  type AppLockRecord,
  type AppLockState,
  type AppLockStatus,
  type StoredCode,
} from './app-lock-state.ts';

import type { OwnerAuthOutcome } from './owner-auth.ts';

export interface AppLockEffects {
  save(record: AppLockRecord): Promise<void>;
  hash(code: string): Promise<StoredCode>;
  matches(code: string, stored: StoredCode): Promise<boolean>;
  unlockName: string;
  touchIdAvailable(): boolean;
  promptTouchId(windowHandle: string | null): Promise<void>;
  ownerAuthAvailable(): boolean;
  authenticateOwner(windowHandle: string | null): Promise<OwnerAuthOutcome>;
  now(): number;
  later(run: () => void, ms: number): () => void;
  changed(status: AppLockStatus): void;
  log(line: string): void;
}

export interface CodeUnlock {
  ok: boolean;
  retryAt: number | null;
}

export interface Recovery {
  ok: boolean;
  reason?: Exclude<OwnerAuthOutcome, 'ok'>;
}

export interface AppLock {
  status(): AppLockStatus;
  lockNow(): void;
  lockForSleep(): void;
  idleFor(seconds: number): void;
  unlockWithTouchId(windowHandle?: string | null): Promise<boolean>;
  unlockWithCode(code: unknown): Promise<CodeUnlock>;
  setCode(input: unknown): Promise<{ ok: boolean }>;
  set(patch: unknown): Promise<AppLockStatus>;
  recover(windowHandle?: string | null): Promise<Recovery>;
  dispose(): void;
}

function codeInput(input: unknown): { current: unknown; next: unknown; enable: boolean } {
  const { current, next, enable } = (input && typeof input === 'object' ? input : {}) as {
    current?: unknown;
    next?: unknown;
    enable?: unknown;
  };
  return { current, next, enable: enable === true };
}

export function createAppLock(record: AppLockRecord, effects: AppLockEffects): AppLock {
  let state = startingState(record);
  let turn: Promise<unknown> = Promise.resolve();
  let stopRetryNotice: (() => void) | null = null;

  let recovering: Promise<Recovery> | null = null;

  const status = () =>
    statusOf(
      state,
      { touchId: effects.touchIdAvailable(), recovery: effects.ownerAuthAvailable() },
      effects.now(),
    );

  const move = (next: AppLockState, reason: string | null = null) => {
    if (next === state) return;
    state = next;
    if (state.retryAt === null) {
      stopRetryNotice?.();
      stopRetryNotice = null;
    }
    if (reason) effects.log(reason);
    effects.changed(status());
  };

  const announceRetryEnd = () => {
    stopRetryNotice?.();
    stopRetryNotice = null;
    if (state.retryAt === null) return;
    stopRetryNotice = effects.later(() => {
      stopRetryNotice = null;
      effects.changed(status());
    }, state.retryAt - effects.now());
  };

  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const run = turn.then(work);
    turn = run.catch(() => undefined);
    return run;
  };

  const forget = async (): Promise<Recovery> => {
    const next = recoveredState(state);
    try {
      await effects.save({ settings: next.settings, code: next.code });
    } catch (error) {
      effects.log(`Could not save the privacy screen settings: ${(error as Error).message}`);
      return { ok: false, reason: 'failed' };
    }
    move(recoveredState(state), 'Privacy code removed after the system confirmed the owner.');
    return { ok: true };
  };

  const recover = async (windowHandle: string | null): Promise<Recovery> => {
    if (!effects.ownerAuthAvailable()) return { ok: false, reason: 'unavailable' };
    const outcome = await effects.authenticateOwner(windowHandle);
    if (outcome !== 'ok') return { ok: false, reason: outcome };
    return inTurn(forget);
  };

  const keep = async (change: Partial<AppLockRecord>): Promise<boolean> => {
    try {
      await effects.save({ settings: state.settings, code: state.code, ...change });
    } catch (error) {
      effects.log(`Could not save the privacy screen settings: ${(error as Error).message}`);
      return false;
    }
    move({ ...state, ...change });
    return true;
  };

  const tryCode = async (code: unknown): Promise<CodeUnlock> => {
    if (!state.locked) return { ok: true, retryAt: null };
    if (codeRefused(state, effects.now())) return { ok: false, retryAt: state.retryAt };
    if (!isLockCode(code) || !state.code) return { ok: false, retryAt: null };
    if (await effects.matches(code, state.code)) {
      move(unlockedState(state), 'Unlocked with the code.');
      return { ok: true, retryAt: null };
    }
    move(afterWrongCode(state, effects.now()));
    if (state.retryAt !== null) effects.log('Too many wrong codes; code entry paused.');
    announceRetryEnd();
    return { ok: false, retryAt: state.retryAt };
  };

  const changeCode = async (input: unknown): Promise<{ ok: boolean }> => {
    const { current, next, enable } = codeInput(input);
    if (state.locked || !isLockCode(next)) return { ok: false };
    if (state.code && !(isLockCode(current) && (await effects.matches(current, state.code)))) {
      return { ok: false };
    }
    const code = await effects.hash(next);
    if (state.locked) return { ok: false };
    const settings = enable ? { ...state.settings, enabled: true } : state.settings;
    return { ok: await keep({ code, settings }) };
  };

  return {
    status,
    lockNow: () => move(lockedState(state), 'Locked by the user.'),
    lockForSleep: () => {
      if (locksOnSleep(state)) move(lockedState(state), 'Locked for sleep or screen lock.');
    },
    idleFor: (seconds) => {
      if (locksWhenIdle(state, seconds)) move(lockedState(state), 'Locked after idle time.');
    },
    unlockWithTouchId: async (windowHandle = null) => {
      if (!state.locked) return true;
      if (!state.settings.touchId || !effects.touchIdAvailable()) return false;
      try {
        await effects.promptTouchId(windowHandle);
      } catch {
        return false;
      }
      if (state.locked) move(unlockedState(state), `Unlocked with ${effects.unlockName}.`);
      return true;
    },
    unlockWithCode: (code) => inTurn(() => tryCode(code)),
    setCode: (input) => inTurn(() => changeCode(input)),
    set: (value) =>
      inTurn(async () => {
        const patch = parseAppLockPatch(value);
        if (patch && !state.locked) await keep({ settings: patchedSettings(state, patch) });
        return status();
      }),
    recover: (windowHandle = null) => {
      recovering ??= recover(windowHandle).finally(() => {
        recovering = null;
      });
      return recovering;
    },
    dispose: () => stopRetryNotice?.(),
  };
}

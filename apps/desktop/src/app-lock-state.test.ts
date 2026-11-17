import { describe, expect, it } from 'vitest';
import {
  afterWrongCode,
  codeRefused,
  DEFAULT_APP_LOCK_SETTINGS,
  isLockCode,
  lockedState,
  locksOnSleep,
  locksWhenIdle,
  parseAppLockPatch,
  parseAppLockRecord,
  patchedSettings,
  RETRY_WAIT_MS,
  serializeAppLockRecord,
  startingState,
  statusOf,
  unlockedState,
  watchesIdle,
  type AppLockRecord,
  type AppLockState,
} from './app-lock-state.ts';

const code = { salt: 'ab'.repeat(16), hash: 'cd'.repeat(64) };

function record(change: Partial<AppLockRecord['settings']> = {}, saved = true): AppLockRecord {
  return {
    settings: { ...DEFAULT_APP_LOCK_SETTINGS, enabled: saved, ...change },
    code: saved ? code : null,
  };
}

function unlocked(change: Partial<AppLockRecord['settings']> = {}): AppLockState {
  return unlockedState(startingState(record(change)));
}

describe('the saved privacy screen file', () => {
  it('falls back to the defaults for a missing, empty or malformed file', () => {
    const defaults = { settings: DEFAULT_APP_LOCK_SETTINGS, code: null };
    expect(parseAppLockRecord(null)).toEqual(defaults);
    expect(parseAppLockRecord('')).toEqual(defaults);
    expect(parseAppLockRecord('{not json')).toEqual(defaults);
    expect(parseAppLockRecord('[1, 2]')).toEqual(defaults);
    expect(parseAppLockRecord('"text"')).toEqual(defaults);
  });

  it('is off by default, locks after 5 minutes, on sleep, with Touch ID and hidden notices', () => {
    expect(DEFAULT_APP_LOCK_SETTINGS).toEqual({
      enabled: false,
      idleMinutes: 5,
      onSleep: true,
      touchId: true,
      hideNotifications: true,
    });
  });

  it('reads back what it wrote', () => {
    const saved = record({ idleMinutes: 30, onSleep: false, touchId: false });
    expect(parseAppLockRecord(serializeAppLockRecord(saved))).toEqual(saved);
  });

  it('replaces each unknown value with its default and ignores unknown keys', () => {
    const raw = JSON.stringify({
      enabled: 'yes',
      idleMinutes: 7,
      onSleep: null,
      touchId: 0,
      hideNotifications: false,
      extra: true,
      code,
    });
    expect(parseAppLockRecord(raw)).toEqual({
      settings: { ...DEFAULT_APP_LOCK_SETTINGS, hideNotifications: false },
      code,
    });
  });

  it('is never enabled without a well-formed saved code', () => {
    for (const broken of [
      undefined,
      null,
      'x',
      { salt: 'zz', hash: code.hash },
      { salt: code.salt },
    ]) {
      const parsed = parseAppLockRecord(JSON.stringify({ enabled: true, code: broken }));
      expect(parsed.code).toBeNull();
      expect(parsed.settings.enabled).toBe(false);
    }
  });
});

describe('a privacy screen code', () => {
  it('is exactly six digits', () => {
    expect(isLockCode('042917')).toBe(true);
    for (const wrong of ['12345', '1234567', '12345a', ' 123456', '١٢٣٤٥٦', 123456, null]) {
      expect(isLockCode(wrong)).toBe(false);
    }
  });
});

describe('a settings change', () => {
  it('accepts known settings and drops unknown keys', () => {
    expect(parseAppLockPatch({ enabled: true, idleMinutes: 15, other: 1 })).toEqual({
      enabled: true,
      idleMinutes: 15,
    });
    expect(parseAppLockPatch({})).toEqual({});
  });

  it('is refused whole when a known setting has a wrong value', () => {
    expect(parseAppLockPatch({ onSleep: true, idleMinutes: 10 })).toBeNull();
    expect(parseAppLockPatch({ touchId: 'on' })).toBeNull();
    expect(parseAppLockPatch(null)).toBeNull();
    expect(parseAppLockPatch('enabled')).toBeNull();
  });

  it('cannot turn the privacy screen on before a code exists', () => {
    const state = startingState(record({}, false));
    expect(patchedSettings(state, { enabled: true, idleMinutes: 1 })).toEqual({
      ...DEFAULT_APP_LOCK_SETTINGS,
      idleMinutes: 1,
    });
  });

  it('turns it on once a code exists', () => {
    const state = unlocked({ enabled: false });
    expect(patchedSettings(state, { enabled: true }).enabled).toBe(true);
  });

  it('changes nothing while locked', () => {
    const state = startingState(record());
    expect(patchedSettings(state, { enabled: false, onSleep: false })).toBe(state.settings);
  });
});

describe('locking', () => {
  it('starts locked after a relaunch when it is on, and open otherwise', () => {
    expect(startingState(record()).locked).toBe(true);
    expect(startingState(record({ enabled: false })).locked).toBe(false);
    expect(startingState(record({}, false)).locked).toBe(false);
  });

  it('does nothing unless it is on with a code', () => {
    const off = unlocked({ enabled: false });
    expect(lockedState(off)).toBe(off);
    const noCode = startingState(record({}, false));
    expect(lockedState(noCode)).toBe(noCode);
    expect(lockedState(unlocked()).locked).toBe(true);
  });

  it('locks from idle time only at or past the chosen minutes', () => {
    const state = unlocked({ idleMinutes: 5 });
    expect(locksWhenIdle(state, 299)).toBe(false);
    expect(locksWhenIdle(state, 300)).toBe(true);
    expect(locksWhenIdle(unlocked({ idleMinutes: 1 }), 60)).toBe(true);
    expect(locksWhenIdle(unlocked({ enabled: false }), 9_999)).toBe(false);
    expect(locksWhenIdle(lockedState(state), 9_999)).toBe(false);
  });

  it('locks on sleep only when that setting is on', () => {
    expect(locksOnSleep(unlocked())).toBe(true);
    expect(locksOnSleep(unlocked({ onSleep: false }))).toBe(false);
    expect(locksOnSleep(unlocked({ enabled: false }))).toBe(false);
  });

  it('watches idle time only while it is on and open', () => {
    expect(watchesIdle(statusOf(unlocked(), false, 0))).toBe(true);
    expect(watchesIdle(statusOf(startingState(record()), false, 0))).toBe(false);
    expect(watchesIdle(statusOf(unlocked({ enabled: false }), false, 0))).toBe(false);
  });
});

describe('wrong codes', () => {
  const fail = (state: AppLockState, times: number, now: number) =>
    Array.from({ length: times }).reduce<AppLockState>((next) => afterWrongCode(next, now), state);

  it('allow four misses, and the fifth in a row pauses code entry for a minute', () => {
    const locked = startingState(record());
    const four = fail(locked, 4, 1_000);
    expect(four.retryAt).toBeNull();
    expect(codeRefused(four, 1_000)).toBe(false);
    const five = afterWrongCode(four, 1_000);
    expect(five.retryAt).toBe(1_000 + RETRY_WAIT_MS);
    expect(codeRefused(five, 1_000 + RETRY_WAIT_MS - 1)).toBe(true);
    expect(codeRefused(five, 1_000 + RETRY_WAIT_MS)).toBe(false);
  });

  it('give five more tries after the wait', () => {
    const waited = fail(startingState(record()), 5, 0);
    const again = fail(waited, 4, RETRY_WAIT_MS);
    expect(again.retryAt).toBeNull();
    expect(afterWrongCode(again, RETRY_WAIT_MS).retryAt).toBe(2 * RETRY_WAIT_MS);
  });

  it('are forgotten after an unlock', () => {
    const almost = fail(startingState(record()), 4, 0);
    const relocked = lockedState(unlockedState(almost));
    expect(fail(relocked, 4, 0).retryAt).toBeNull();
    expect(unlockedState(fail(relocked, 5, 0)).retryAt).toBeNull();
  });
});

describe('the status sent to windows', () => {
  it('carries the settings and state, never the saved code', () => {
    const status = statusOf(startingState(record()), true, 0);
    expect(status).toEqual({
      ...DEFAULT_APP_LOCK_SETTINGS,
      enabled: true,
      locked: true,
      hasCode: true,
      touchIdAvailable: true,
      retryAt: null,
    });
    expect(JSON.stringify(status)).not.toContain(code.hash);
  });

  it('shows the retry time only while the wait lasts', () => {
    const paused = { ...startingState(record()), retryAt: 5_000 };
    expect(statusOf(paused, false, 4_999).retryAt).toBe(5_000);
    expect(statusOf(paused, false, 5_000).retryAt).toBeNull();
  });
});

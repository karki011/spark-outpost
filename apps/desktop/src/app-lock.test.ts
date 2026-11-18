import { describe, expect, it, vi } from 'vitest';
import { createAppLock } from './app-lock.ts';
import type { OwnerAuthOutcome } from './owner-auth.ts';
import {
  DEFAULT_APP_LOCK_SETTINGS,
  RETRY_WAIT_MS,
  type AppLockRecord,
  type AppLockStatus,
  type StoredCode,
} from './app-lock-state.ts';

const stored = (code: string): StoredCode => ({ salt: 'ab'.repeat(16), hash: code.repeat(22) });

function setup(
  options: { code?: string | null; enabled?: boolean; touchId?: boolean; sensor?: boolean } = {},
) {
  const code = options.code === undefined ? '111111' : options.code;
  const record: AppLockRecord = {
    settings: {
      ...DEFAULT_APP_LOCK_SETTINGS,
      enabled: (options.enabled ?? true) && code !== null,
      touchId: options.touchId ?? true,
    },
    code: code === null ? null : stored(code),
  };
  const scene = {
    now: 1_000,
    sensor: options.sensor ?? true,
    finger: 'match' as 'match' | 'cancel',
    saveFails: false,
    saved: [] as AppLockRecord[],
    changes: [] as AppLockStatus[],
    prompts: 0,
    owner: 'ok' as OwnerAuthOutcome | null,
    ownerPrompts: 0,
    timers: [] as { run: () => void; ms: number; cancelled: boolean }[],
  };
  const lock = createAppLock(record, {
    save: async (next) => {
      if (scene.saveFails) throw new Error('disk full');
      scene.saved.push(next);
    },
    hash: async (next) => stored(next),
    matches: async (given, saved) => stored(given).hash === saved.hash,
    touchIdAvailable: () => scene.sensor,
    promptTouchId: async () => {
      scene.prompts += 1;
      if (scene.finger === 'cancel') throw new Error('cancelled');
    },
    ownerAuthAvailable: () => scene.owner !== null,
    authenticateOwner: async () => {
      scene.ownerPrompts += 1;
      return scene.owner ?? 'unavailable';
    },
    now: () => scene.now,
    later: (run, ms) => {
      const timer = { run, ms, cancelled: false };
      scene.timers.push(timer);
      return () => void (timer.cancelled = true);
    },
    changed: (status) => scene.changes.push(status),
    log: vi.fn(),
  });
  return { lock, scene };
}

async function opened(options: Parameters<typeof setup>[0] = {}) {
  const made = setup(options);
  await made.lock.unlockWithCode(options.code ?? '111111');
  made.scene.changes.length = 0;
  return made;
}

describe('the privacy screen', () => {
  it('starts locked after a relaunch when it is on', () => {
    expect(setup().lock.status().locked).toBe(true);
    expect(setup({ enabled: false }).lock.status().locked).toBe(false);
    expect(setup({ code: null }).lock.status()).toMatchObject({ locked: false, hasCode: false });
  });

  it('unlocks with the right code and tells every window', async () => {
    const { lock, scene } = setup();
    expect(await lock.unlockWithCode('111111')).toEqual({ ok: true, retryAt: null });
    expect(lock.status().locked).toBe(false);
    expect(scene.changes.at(-1)).toMatchObject({ locked: false });
  });

  it('stays locked on a wrong or malformed code', async () => {
    const { lock } = setup();
    expect(await lock.unlockWithCode('222222')).toEqual({ ok: false, retryAt: null });
    expect(await lock.unlockWithCode('11111')).toEqual({ ok: false, retryAt: null });
    expect(await lock.unlockWithCode({ code: '111111' })).toEqual({ ok: false, retryAt: null });
    expect(lock.status().locked).toBe(true);
  });

  it('pauses code entry for a minute after five wrong codes in a row, even for the right one', async () => {
    const { lock, scene } = setup();
    for (let miss = 0; miss < 4; miss += 1) await lock.unlockWithCode('222222');
    const retryAt = scene.now + RETRY_WAIT_MS;
    expect(await lock.unlockWithCode('222222')).toEqual({ ok: false, retryAt });
    expect(lock.status().retryAt).toBe(retryAt);
    expect(await lock.unlockWithCode('111111')).toEqual({ ok: false, retryAt });
    scene.now = retryAt;
    expect(lock.status().retryAt).toBeNull();
    expect(await lock.unlockWithCode('111111')).toEqual({ ok: true, retryAt: null });
  });

  it('tells every window when code entry pauses and once more when the wait ends', async () => {
    const { lock, scene } = setup();
    for (let miss = 0; miss < 5; miss += 1) await lock.unlockWithCode('222222');
    expect(scene.changes.at(-1)?.retryAt).toBe(scene.now + RETRY_WAIT_MS);
    expect(scene.timers.map((timer) => timer.ms)).toEqual([RETRY_WAIT_MS]);
    const told = scene.changes.length;
    scene.now += RETRY_WAIT_MS;
    scene.timers[0]!.run();
    expect(scene.changes).toHaveLength(told + 1);
    expect(scene.changes.at(-1)).toMatchObject({ locked: true, retryAt: null });
  });

  it('drops the end-of-wait notice when Touch ID unlocks first', async () => {
    const { lock, scene } = setup();
    for (let miss = 0; miss < 5; miss += 1) await lock.unlockWithCode('222222');
    await lock.unlockWithTouchId();
    expect(scene.timers[0]!.cancelled).toBe(true);
  });

  it('counts five wrong codes sent at once the same as five sent in turn', async () => {
    const { lock, scene } = setup();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => lock.unlockWithCode('222222')),
    );
    expect(results.map((result) => result.retryAt !== null)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(lock.status().retryAt).toBe(scene.now + RETRY_WAIT_MS);
  });

  it('forgets earlier misses after a successful unlock', async () => {
    const { lock } = setup();
    for (let miss = 0; miss < 4; miss += 1) await lock.unlockWithCode('222222');
    await lock.unlockWithCode('111111');
    lock.lockNow();
    for (let miss = 0; miss < 4; miss += 1) {
      expect((await lock.unlockWithCode('222222')).retryAt).toBeNull();
    }
  });

  it('locks on the command only when it is on with a code', async () => {
    const off = setup({ enabled: false });
    off.lock.lockNow();
    expect(off.lock.status().locked).toBe(false);
    expect(off.scene.changes).toEqual([]);
    const on = await opened();
    on.lock.lockNow();
    on.lock.lockNow();
    expect(on.scene.changes.map((status) => status.locked)).toEqual([true]);
  });

  it('locks after the chosen idle time', async () => {
    const { lock } = await opened();
    lock.idleFor(299);
    expect(lock.status().locked).toBe(false);
    lock.idleFor(300);
    expect(lock.status().locked).toBe(true);
  });

  it('locks on sleep or screen lock unless that is turned off', async () => {
    const { lock } = await opened();
    await lock.set({ onSleep: false });
    lock.lockForSleep();
    expect(lock.status().locked).toBe(false);
    await lock.set({ onSleep: true });
    lock.lockForSleep();
    expect(lock.status().locked).toBe(true);
  });
});

describe('unlocking with Touch ID', () => {
  it('unlocks when the fingerprint matches', async () => {
    const { lock, scene } = setup();
    expect(await lock.unlockWithTouchId()).toBe(true);
    expect(lock.status().locked).toBe(false);
    expect(scene.prompts).toBe(1);
  });

  it('stays locked and counts nothing when the prompt is cancelled or fails', async () => {
    const { lock, scene } = setup();
    scene.finger = 'cancel';
    for (let attempt = 0; attempt < 6; attempt += 1) {
      expect(await lock.unlockWithTouchId()).toBe(false);
    }
    expect(lock.status()).toMatchObject({ locked: true, retryAt: null });
    expect(await lock.unlockWithCode('111111')).toEqual({ ok: true, retryAt: null });
  });

  it('never prompts when the setting is off or the Mac has no Touch ID', async () => {
    const off = setup({ touchId: false });
    expect(await off.lock.unlockWithTouchId()).toBe(false);
    const noSensor = setup({ sensor: false });
    expect(await noSensor.lock.unlockWithTouchId()).toBe(false);
    expect(off.scene.prompts + noSensor.scene.prompts).toBe(0);
    expect(noSensor.lock.status().touchIdAvailable).toBe(false);
  });

  it('works while code entry is paused', async () => {
    const { lock } = setup();
    for (let miss = 0; miss < 5; miss += 1) await lock.unlockWithCode('222222');
    expect(await lock.unlockWithTouchId()).toBe(true);
    expect(lock.status()).toMatchObject({ locked: false, retryAt: null });
  });
});

describe('setting the code', () => {
  it('saves a first code without asking for a current one', async () => {
    const { lock, scene } = setup({ code: null });
    expect(await lock.setCode({ next: '424242' })).toEqual({ ok: true });
    expect(lock.status().hasCode).toBe(true);
    expect(scene.saved.at(-1)?.code).toEqual(stored('424242'));
  });

  it('turns the privacy screen on in the same write when asked to', async () => {
    const { lock, scene } = setup({ code: null });
    expect(await lock.setCode({ next: '424242', enable: true })).toEqual({ ok: true });
    expect(scene.saved).toHaveLength(1);
    expect(scene.saved[0]).toMatchObject({ settings: { enabled: true }, code: stored('424242') });
    expect(scene.changes).toHaveLength(1);
    expect(scene.changes[0]).toMatchObject({ enabled: true, hasCode: true, locked: false });
  });

  it('leaves it off without enable: true, and never turns it off', async () => {
    const off = setup({ code: null });
    await off.lock.setCode({ next: '424242', enable: 'yes' });
    expect(off.lock.status().enabled).toBe(false);
    const on = await opened();
    await on.lock.setCode({ current: '111111', next: '424242', enable: false });
    expect(on.lock.status().enabled).toBe(true);
  });

  it('turns nothing on when the code is refused or cannot be saved', async () => {
    const { lock, scene } = setup({ code: null });
    await lock.setCode({ next: '12', enable: true });
    scene.saveFails = true;
    expect(await lock.setCode({ next: '424242', enable: true })).toEqual({ ok: false });
    expect(lock.status()).toMatchObject({ enabled: false, hasCode: false });
  });

  it('accepts only six digits', async () => {
    const { lock, scene } = setup({ code: null });
    for (const next of ['12345', '1234567', 'abcdef', 123456, undefined]) {
      expect(await lock.setCode({ next })).toEqual({ ok: false });
    }
    expect(await lock.setCode(null)).toEqual({ ok: false });
    expect(scene.saved).toEqual([]);
  });

  it('needs the right current code to replace one', async () => {
    const { lock, scene } = await opened();
    expect(await lock.setCode({ next: '424242' })).toEqual({ ok: false });
    expect(await lock.setCode({ current: '999999', next: '424242' })).toEqual({ ok: false });
    expect(scene.saved).toEqual([]);
    expect(await lock.setCode({ current: '111111', next: '424242' })).toEqual({ ok: true });
    lock.lockNow();
    expect((await lock.unlockWithCode('111111')).ok).toBe(false);
    expect((await lock.unlockWithCode('424242')).ok).toBe(true);
  });

  it('is refused while locked', async () => {
    const { lock, scene } = setup();
    expect(await lock.setCode({ current: '111111', next: '424242' })).toEqual({ ok: false });
    expect(scene.saved).toEqual([]);
  });

  it('keeps the old code when the file cannot be written', async () => {
    const { lock, scene } = await opened();
    scene.saveFails = true;
    expect(await lock.setCode({ current: '111111', next: '424242' })).toEqual({ ok: false });
    lock.lockNow();
    expect((await lock.unlockWithCode('111111')).ok).toBe(true);
  });
});

describe('forgot code', () => {
  it('removes the code, turns the lock off and unlocks after macOS confirms the owner', async () => {
    const { lock, scene } = setup();
    expect(lock.status().recoveryAvailable).toBe(true);
    expect(await lock.recover()).toEqual({ ok: true });
    expect(scene.saved).toEqual([
      { settings: { ...DEFAULT_APP_LOCK_SETTINGS, enabled: false }, code: null },
    ]);
    expect(scene.changes).toHaveLength(1);
    expect(scene.changes[0]).toMatchObject({ locked: false, enabled: false, hasCode: false });
    lock.lockNow();
    expect(lock.status().locked).toBe(false);
  });

  it('stays locked with the code kept when the owner cancels or macOS fails', async () => {
    const { lock, scene } = setup();
    scene.owner = 'cancelled';
    expect(await lock.recover()).toEqual({ ok: false, reason: 'cancelled' });
    scene.owner = 'failed';
    expect(await lock.recover()).toEqual({ ok: false, reason: 'failed' });
    expect(scene.saved).toEqual([]);
    expect(scene.changes).toEqual([]);
    expect(lock.status()).toMatchObject({ locked: true, hasCode: true, enabled: true });
    expect((await lock.unlockWithCode('111111')).ok).toBe(true);
  });

  it('is unavailable, with no prompt, when macOS owner authentication is missing', async () => {
    const { lock, scene } = setup();
    scene.owner = null;
    expect(lock.status().recoveryAvailable).toBe(false);
    expect(await lock.recover()).toEqual({ ok: false, reason: 'unavailable' });
    expect(scene.ownerPrompts).toBe(0);
    expect(lock.status().locked).toBe(true);
  });

  it('works during the wrong-code wait and ends it', async () => {
    const { lock, scene } = setup();
    for (let miss = 0; miss < 5; miss += 1) await lock.unlockWithCode('222222');
    expect(lock.status().retryAt).not.toBeNull();
    expect(await lock.recover()).toEqual({ ok: true });
    expect(lock.status()).toMatchObject({ locked: false, retryAt: null });
    expect(scene.timers[0]!.cancelled).toBe(true);
  });

  it('works while unlocked, so a new code needs no current one', async () => {
    const { lock } = await opened();
    expect(await lock.recover()).toEqual({ ok: true });
    expect(lock.status()).toMatchObject({ locked: false, hasCode: false, enabled: false });
    expect(await lock.setCode({ next: '424242', enable: true })).toEqual({ ok: true });
  });

  it('keeps the code and stays locked when the file cannot be written', async () => {
    const { lock, scene } = setup();
    scene.saveFails = true;
    expect(await lock.recover()).toEqual({ ok: false, reason: 'failed' });
    expect(lock.status()).toMatchObject({ locked: true, hasCode: true });
  });

  it('shows one macOS prompt for requests made at the same time', async () => {
    const { lock, scene } = setup();
    const results = await Promise.all([lock.recover(), lock.recover()]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(scene.ownerPrompts).toBe(1);
    expect(scene.changes).toHaveLength(1);
  });
});

describe('changing settings', () => {
  it('cannot turn the privacy screen on before a code exists', async () => {
    const { lock } = setup({ code: null });
    expect((await lock.set({ enabled: true })).enabled).toBe(false);
    await lock.setCode({ next: '424242' });
    expect((await lock.set({ enabled: true })).enabled).toBe(true);
  });

  it('saves the change with the code and tells every window', async () => {
    const { lock, scene } = await opened();
    const status = await lock.set({ idleMinutes: 15, hideNotifications: false });
    expect(status).toMatchObject({ idleMinutes: 15, hideNotifications: false });
    expect(scene.saved.at(-1)).toEqual({
      settings: {
        ...DEFAULT_APP_LOCK_SETTINGS,
        enabled: true,
        idleMinutes: 15,
        hideNotifications: false,
      },
      code: stored('111111'),
    });
    expect(scene.changes.at(-1)).toEqual(status);
  });

  it('is refused while locked and for a malformed change', async () => {
    const locked = setup();
    expect(await locked.lock.set({ enabled: false })).toMatchObject({
      enabled: true,
      locked: true,
    });
    const open = await opened();
    expect((await open.lock.set({ idleMinutes: 2 })).idleMinutes).toBe(5);
    expect(locked.scene.saved.concat(open.scene.saved)).toEqual([]);
  });

  it('never locks once it is turned off', async () => {
    const { lock } = await opened();
    await lock.set({ enabled: false });
    lock.lockNow();
    lock.lockForSleep();
    lock.idleFor(9_999);
    expect(lock.status().locked).toBe(false);
  });
});

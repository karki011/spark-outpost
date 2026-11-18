import { describe, expect, it } from 'vitest';
import { lockPose, lookOffset, poseMood, type LockMoment } from './lock-pose.ts';

const REST: LockMoment = {
  opened: false,
  refusing: false,
  waiting: false,
  asking: false,
  digits: 0,
};

describe('lockPose', () => {
  it('sleeps while locked and untouched', () => {
    expect(lockPose(REST)).toBe('asleep');
  });

  it('wakes with the first digit and stays awake while typing', () => {
    expect(lockPose({ ...REST, digits: 1 })).toBe('awake');
    expect(lockPose({ ...REST, digits: 6 })).toBe('awake');
  });

  it('looks expectant while Touch ID is asking', () => {
    expect(lockPose({ ...REST, asking: true })).toBe('expectant');
  });

  it('says no right after a wrong code, then sulks through the wait', () => {
    expect(lockPose({ ...REST, refusing: true, waiting: true })).toBe('no');
    expect(lockPose({ ...REST, waiting: true })).toBe('sulk');
    expect(lockPose({ ...REST, waiting: true, digits: 3, asking: true })).toBe('sulk');
  });

  it('is happy once unlocked, whatever came before', () => {
    expect(lockPose({ opened: true, refusing: true, waiting: true, asking: true, digits: 2 })).toBe(
      'happy',
    );
  });
});

describe('poseMood', () => {
  it('draws each pose with one of Scout’s own moods', () => {
    expect(poseMood('asleep')).toBe('sleep');
    expect(poseMood('awake')).toBeNull();
    expect(poseMood('expectant')).toBe('alert');
    expect(poseMood('no')).toBe('sad');
    expect(poseMood('sulk')).toBe('sad');
    expect(poseMood('happy')).toBe('happy');
  });
});

describe('lookOffset', () => {
  it('moves the eyes from the first box to the last', () => {
    expect(lookOffset(1)).toBe(-2.4);
    expect(lookOffset(6)).toBe(2.4);
    expect(lookOffset(3)).toBeLessThan(0);
    expect(lookOffset(4)).toBeGreaterThan(0);
  });

  it('stays inside the face for counts outside the code', () => {
    expect(lookOffset(0)).toBe(-2.4);
    expect(lookOffset(9)).toBe(2.4);
  });
});

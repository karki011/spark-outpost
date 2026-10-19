import { describe, expect, it } from 'vitest';
import { hourCycleArgs, hourCycleFromArgs, macHourCycle } from './hour-cycle-arg.ts';

describe('the Mac 24-hour time setting', () => {
  it('follows a forced 24-hour or 12-hour clock and otherwise leaves it to the locale', () => {
    expect(macHourCycle((key) => key === 'AppleICUForce24HourTime')).toBe('h23');
    expect(macHourCycle((key) => key === 'AppleICUForce12HourTime')).toBe('h12');
    expect(macHourCycle(() => false)).toBeNull();
  });

  it('reaches the page through a launch argument and ignores anything else', () => {
    expect(hourCycleFromArgs(['x', ...hourCycleArgs('h23')])).toBe('h23');
    expect(hourCycleFromArgs(hourCycleArgs(null))).toBeNull();
    expect(hourCycleFromArgs(['--spark-hour-cycle=h24'])).toBeNull();
  });
});

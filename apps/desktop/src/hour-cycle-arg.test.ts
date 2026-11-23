import { describe, expect, it } from 'vitest';
import {
  hourCycleArgs,
  hourCycleFromArgs,
  macHourCycle,
  windowsHourCycle,
  windowsShortTime,
} from './hour-cycle-arg.ts';

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

describe('the Windows short time format', () => {
  it('reads the format from the registry output', () => {
    const output =
      '\r\nHKEY_CURRENT_USER\\Control Panel\\International\r\n    sShortTime    REG_SZ    h:mm tt\r\n\r\n';
    expect(windowsShortTime(output)).toBe('h:mm tt');
    expect(
      windowsShortTime('ERROR: The system was unable to find the specified registry key'),
    ).toBeNull();
  });

  it('uses a 24-hour clock for H and a 12-hour clock for h, ignoring quoted text', () => {
    expect(windowsHourCycle('HH:mm')).toBe('h23');
    expect(windowsHourCycle('H.mm')).toBe('h23');
    expect(windowsHourCycle('h:mm tt')).toBe('h12');
    expect(windowsHourCycle("'Hour' h:mm")).toBe('h12');
    expect(windowsHourCycle(null)).toBeNull();
    expect(windowsHourCycle('mm')).toBeNull();
  });
});

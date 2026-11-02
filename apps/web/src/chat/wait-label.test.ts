import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HourCycle } from '../calendar/clock-format.ts';
import { runStep, sleepingLine, waitedOnText, waitLabel } from './wait-label.ts';

const mac = vi.hoisted(() => ({ cycle: 'h23' as HourCycle }));
vi.mock('../desktop/hour-cycle.ts', () => ({ hourCycle: () => mac.cycle }));

const wakesAt = new Date(2026, 9, 22, 14, 48).getTime();
const sleeping = { agents: 0, tasks: 0, names: [], wakesAt };

afterEach(() => {
  mac.cycle = 'h23';
});

describe('the time a sleeping agent wakes', () => {
  it('follows the Mac’s 24-hour setting', () => {
    expect(waitLabel(1, sleeping)).toBe('Sleeping until 14:48');
    expect(sleepingLine(wakesAt)).toBe('Sleeping until 14:48');
  });

  it('follows the Mac’s 12-hour setting', () => {
    mac.cycle = 'h12';
    expect(waitLabel(1, sleeping)).toBe('Sleeping until 2:48 PM');
    expect(waitedOnText(2, { ...sleeping, tasks: 1 })).toBe(
      '1 background task and a wakeup at 2:48 PM',
    );
  });

  it('replaces the server’s step for a chat that sleeps, and keeps any other step', () => {
    mac.cycle = 'h12';
    const step = 'Sleeping until 14:48';
    expect(runStep({ step, waitingOn: 1, background: sleeping })).toBe('Sleeping until 2:48 PM');
    expect(runStep({ step: 'Reading api.ts' })).toBe('Reading api.ts');
  });
});

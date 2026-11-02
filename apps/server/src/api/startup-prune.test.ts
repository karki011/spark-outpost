import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../persistence/db.ts';
import { schedulePrune, type StartupPrune } from './startup-prune.ts';

const HOUR = 60 * 60 * 1000;

function options(reported: string[]): StartupPrune {
  return {
    db: {} as Db,
    workspaceId: 'workspace',
    auditRetentionDays: 90,
    report: (message, error) => reported.push(`${message}: ${(error as Error).message}`),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pruning old rows every hour', () => {
  it('prunes once at start and again every hour until stopped', async () => {
    const prune = vi.fn(() => Promise.resolve());
    const schedule = schedulePrune(options([]), HOUR, prune);
    expect(prune).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HOUR);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(prune).toHaveBeenCalledTimes(3);

    schedule.stop();
    await vi.advanceTimersByTimeAsync(3 * HOUR);
    expect(prune).toHaveBeenCalledTimes(3);
  });

  it('never starts a run while the previous one is still going', async () => {
    let finish: () => void = () => undefined;
    const prune = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const schedule = schedulePrune(options([]), HOUR, prune);

    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(prune).toHaveBeenCalledTimes(1);

    finish();
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(prune).toHaveBeenCalledTimes(2);
    schedule.stop();
  });

  it('reports a failed run and keeps the schedule going', async () => {
    const reported: string[] = [];
    const prune = vi
      .fn<(options: StartupPrune) => Promise<void>>()
      .mockRejectedValueOnce(new Error('database restarting'))
      .mockResolvedValue(undefined);
    const schedule = schedulePrune(options(reported), HOUR, prune);

    await vi.advanceTimersByTimeAsync(HOUR);

    expect(reported).toEqual(['Could not prune old rows: database restarting']);
    expect(prune).toHaveBeenCalledTimes(2);
    schedule.stop();
  });
});

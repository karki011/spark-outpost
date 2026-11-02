import { afterEach, describe, expect, it, vi } from 'vitest';
import { armShutdownWatchdog, runShutdownSteps } from './shutdown-steps.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('running shutdown steps', () => {
  it('runs every step in order and waits for each one', async () => {
    const order: string[] = [];
    await runShutdownSteps([
      ['first', () => order.push('first')],
      [
        'slow',
        () =>
          new Promise<void>((resolve) =>
            setTimeout(() => {
              order.push('slow');
              resolve();
            }, 5),
          ),
      ],
      ['last', () => order.push('last')],
    ]);
    expect(order).toEqual(['first', 'slow', 'last']);
  });

  it('reports a step that throws or rejects and still runs the later ones', async () => {
    const order: string[] = [];
    const reported: string[] = [];
    await runShutdownSteps(
      [
        [
          'terminals',
          () => {
            throw new Error('tmux gone');
          },
        ],
        ['listener', () => Promise.reject(new Error('socket closed'))],
        ['database pool', () => order.push('database pool')],
      ],
      (message, error) => reported.push(`${message}: ${(error as Error).message}`),
    );
    expect(reported).toEqual([
      'Could not stop terminals during shutdown: tmux gone',
      'Could not stop listener during shutdown: socket closed',
    ]);
    expect(order).toEqual(['database pool']);
  });
});

describe('the shutdown watchdog', () => {
  it('exits with a failure and a log line when shutdown hangs', () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const lines: string[] = [];
    armShutdownWatchdog(exit, (line) => lines.push(line), 15_000);

    vi.advanceTimersByTime(14_999);
    expect(exit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(lines).toEqual(['Shutdown did not finish within 15 s; exiting now.']);
  });
});

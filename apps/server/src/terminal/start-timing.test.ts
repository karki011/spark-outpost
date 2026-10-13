import { describe, expect, it, vi } from 'vitest';
import {
  dependenciesLine,
  startLine,
  startTimer,
  worktreeOf,
  type StartRecord,
} from './start-timing.ts';

const SESSION = '3f0c8a52-5a51-4a0e-9d0b-7c1f6f0f2a11';
const ALLOWED =
  /^Terminal start session=([a-zA-Z0-9_-]+) provider=(claude|codex|unknown) outcome=(started|failed|ended_before_output) total_ms=\d+( tmux=(yes|no))?( worktree=(created|reused|none))?( [a-z_]+_ms=\d+| new_session=direct)*( failed_in=[a-z_]+)?( error=\w+)?( status=\d+)?( code=[A-Z0-9_]+)?$/;

const record = (over: Partial<StartRecord> = {}): StartRecord => ({
  sessionId: SESSION,
  provider: 'claude',
  outcome: 'started',
  totalMs: 912.4,
  tmux: true,
  worktree: 'created',
  phases: {
    locate_cli: 301.2,
    prepare_session: 420.6,
    worktree: 388,
    grant: 0.4,
    prepare_launch: 95,
    spawn: 61,
    new_session: 48,
    attach: 22,
    first_output: 140,
  },
  failedIn: null,
  error: null,
  ...over,
});

function clock() {
  let at = 0;
  return {
    now: () => at,
    pass: (by: number) => {
      at += by;
    },
  };
}

describe('the Terminal start log line', () => {
  it('gives every phase in start order with whole milliseconds', () => {
    expect(startLine(record())).toBe(
      `Terminal start session=${SESSION} provider=claude outcome=started total_ms=912 tmux=yes worktree=created locate_cli_ms=301 prepare_session_ms=421 worktree_ms=388 grant_ms=0 prepare_launch_ms=95 spawn_ms=61 new_session_ms=48 attach_ms=22 first_output_ms=140`,
    );
  });

  it('says direct in place of a tmux new-session time when tmux did not run the session', () => {
    const line = startLine(
      record({ tmux: false, phases: { spawn: 12, first_output: 30 }, worktree: 'none' }),
    );
    expect(line).toBe(
      `Terminal start session=${SESSION} provider=claude outcome=started total_ms=912 tmux=no worktree=none spawn_ms=12 new_session=direct first_output_ms=30`,
    );
  });

  it('names the failing phase and the error class, status and code, never the message', () => {
    const cause = Object.assign(new Error('spawn /Users/me/acme/bin/claude ENOENT'), {
      code: 'ENOENT',
    });
    class LaunchError extends Error {
      status = 500;
    }
    const error = new LaunchError('Could not start in /Users/me/acme with token sk-123', {
      cause,
    });
    const line = startLine(
      record({
        outcome: 'failed',
        tmux: null,
        worktree: 'reused',
        phases: { locate_cli: 5, prepare_session: 9, worktree: 3, grant: 1 },
        failedIn: 'prepare_launch',
        error,
      }),
    );
    expect(line).toBe(
      `Terminal start session=${SESSION} provider=claude outcome=failed total_ms=912 worktree=reused locate_cli_ms=5 prepare_session_ms=9 worktree_ms=3 grant_ms=1 failed_in=prepare_launch error=LaunchError status=500 code=ENOENT`,
    );
  });

  it('lets nothing through but the allowed fields, whatever the record holds', () => {
    const hostile = {
      sessionId: '/Users/me/acme project',
      provider: 'claude --dangerously /Users/me',
      outcome: 'failed',
      totalMs: Number.NaN,
      tmux: null,
      worktree: null,
      phases: { locate_cli: Number.POSITIVE_INFINITY, grant: -4, '/Users/me': 3 },
      failedIn: '/Users/me/acme',
      error: Object.assign(new Error('fatal: /Users/me/acme is locked'), {
        code: '/Users/me/acme',
        status: 'sk-live-123',
        name: 'Acme chat /Users/me',
      }),
    } as unknown as StartRecord;
    const lines = [
      startLine(hostile),
      startLine({ ...hostile, error: '/Users/me/acme' }),
      startLine({ ...hostile, error: Object.create(Error.prototype) as Error }),
      startLine(record()),
      startLine(record({ tmux: false, phases: {} })),
    ];
    for (const line of lines) {
      expect(line).toMatch(ALLOWED);
      expect(line).not.toMatch(/\/|Users|acme|sk-|dangerously/);
    }
    expect(lines[0]).toBe(
      'Terminal start session=none provider=unknown outcome=failed total_ms=0 grant_ms=0 error=Error',
    );
  });

  it('gives the dependency step its own line with fixed words and a duration', () => {
    expect(
      dependenciesLine({ sessionId: SESSION, outcome: 'prepared', method: 'clone', ms: 1716.4 }),
    ).toBe(`Terminal dependencies session=${SESSION} outcome=prepared method=clone total_ms=1716`);
    expect(
      dependenciesLine({
        sessionId: '/Users/me',
        outcome: 'failed in /Users/me',
        method: 'pnpm install /Users/me',
        ms: Number.NaN,
      }),
    ).toBe('Terminal dependencies session=none outcome=none method=none total_ms=0');
  });

  it('reads worktree use from where the chat was placed', () => {
    expect(worktreeOf({ input: {}, note: 'Working in your checkout.' })).toBe('none');
    expect(worktreeOf({ input: { chatWorktree: true }, note: 'Working on spark/a.' })).toBe(
      'created',
    );
    expect(worktreeOf({ input: { chatWorktree: true }, note: null })).toBe('reused');
  });
});

describe('timing one Terminal start', () => {
  const run = async () => {
    const time = clock();
    const log = vi.fn<(line: string) => void>();
    const timer = startTimer(log, time.now);
    const step = (phase: Parameters<typeof timer.time>[0], spent: number) =>
      timer.time(phase, async () => time.pass(spent));
    return { time, log, timer, step };
  };

  it('writes one line when the first output arrives after the start returned', async () => {
    const { time, log, timer, step } = await run();
    const launch = async () => {
      timer.provider('codex');
      await step('locate_cli', 40);
      await timer.time('prepare_session', () =>
        timer.place(async () => {
          time.pass(25);
          return { input: { chatWorktree: true }, note: null };
        })(),
      );
      timer.session(SESSION);
      await step('grant', 2);
      await step('prepare_launch', 10);
      const spawned = timer.observer.begin('spawn');
      const output = timer.observer.begin('first_output');
      const created = timer.observer.begin('new_session');
      time.pass(30);
      created();
      const attached = timer.observer.begin('attach');
      timer.observer.tmux(true);
      time.pass(1);
      spawned();
      time.pass(3);
      return { attached, output };
    };
    const { attached, output } = await timer.watch(launch());
    expect(log).not.toHaveBeenCalled();
    time.pass(6);
    attached();
    time.pass(50);
    output();
    output();
    timer.observer.ended();
    expect(log).toHaveBeenCalledExactlyOnceWith(
      `Terminal start session=${SESSION} provider=codex outcome=started total_ms=111 tmux=yes worktree=reused locate_cli_ms=40 prepare_session_ms=25 worktree_ms=25 grant_ms=2 prepare_launch_ms=10 spawn_ms=31 new_session_ms=30 attach_ms=10 first_output_ms=90`,
    );
  });

  it('writes the line when output came before the start returned', async () => {
    const { time, log, timer } = await run();
    await timer.watch(
      (async () => {
        const spawned = timer.observer.begin('spawn');
        const output = timer.observer.begin('first_output');
        time.pass(4);
        spawned();
        output();
        expect(log).not.toHaveBeenCalled();
      })(),
    );
    expect(log).toHaveBeenCalledExactlyOnceWith(
      'Terminal start session=none provider=unknown outcome=started total_ms=4 tmux=no spawn_ms=4 new_session=direct first_output_ms=4',
    );
  });

  it('writes the line when the session ends before it printed anything', async () => {
    const { time, log, timer } = await run();
    await timer.watch(
      (async () => {
        timer.observer.begin('spawn')();
        timer.observer.begin('first_output');
        time.pass(7);
      })(),
    );
    timer.observer.ended();
    timer.observer.ended();
    expect(log).toHaveBeenCalledExactlyOnceWith(
      'Terminal start session=none provider=unknown outcome=ended_before_output total_ms=7 tmux=no spawn_ms=0 new_session=direct',
    );
  });

  it('writes a failed line once, naming the phase that threw, and passes the error on', async () => {
    const { time, log, timer, step } = await run();
    const failure = Object.assign(new TypeError('no such file /Users/me/acme'), { code: 'EACCES' });
    const launch = async () => {
      timer.provider('claude');
      await step('locate_cli', 8);
      await timer.time('prepare_session', () =>
        timer.place(async (): Promise<{ input: object; note: null }> => {
          time.pass(900);
          throw failure;
        })(),
      );
    };
    await expect(timer.watch(launch())).rejects.toBe(failure);
    timer.observer.ended();
    expect(log).toHaveBeenCalledExactlyOnceWith(
      'Terminal start session=none provider=claude outcome=failed total_ms=908 locate_cli_ms=8 failed_in=worktree error=TypeError code=EACCES',
    );
  });

  it('stays silent for a request that never began a start', async () => {
    const { log, timer } = await run();
    await expect(timer.watch(Promise.reject(new Error('already running')))).rejects.toThrow();
    await timer.watch(Promise.resolve('attached'));
    timer.observer.ended();
    expect(log).not.toHaveBeenCalled();
  });
});

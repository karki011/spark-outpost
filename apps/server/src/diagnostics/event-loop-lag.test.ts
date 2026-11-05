import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActiveWork, lagWarning, recentLagWarnings, startLagMonitor } from './event-loop-lag.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('lagWarning', () => {
  it('stays quiet at or under the threshold', () => {
    expect(lagWarning('API', 200, ['GET /api/a'])).toBeNull();
    expect(lagWarning('API', 12, [])).toBeNull();
  });

  it('names the process, the lag and what was running', () => {
    expect(lagWarning('API', 850.4, ['GET /api/tasks/1/changes'])).toBe(
      'Event loop blocked for 850 ms in the API during GET /api/tasks/1/changes',
    );
    expect(lagWarning('worker', 300, [])).toBe(
      'Event loop blocked for 300 ms in the worker with no request or job running',
    );
  });

  it('lists at most five activities', () => {
    const active = Array.from({ length: 7 }, (_, index) => `run ${index}`);
    expect(lagWarning('worker', 900, active)).toBe(
      'Event loop blocked for 900 ms in the worker during run 0, run 1, run 2, run 3, run 4 and 2 more',
    );
  });
});

describe('ActiveWork', () => {
  it('reports work that finished since the last look, then only what still runs', () => {
    const work = new ActiveWork();
    const doneExport = work.begin('GET /api/export');
    work.begin('POST /api/send');
    doneExport();
    expect(work.takeRecent()).toEqual(['GET /api/export', 'POST /api/send']);
    expect(work.takeRecent()).toEqual(['POST /api/send']);
  });

  it('keeps a label while another request with the same label still runs', () => {
    const work = new ActiveWork();
    const first = work.begin('GET /api/a');
    work.begin('GET /api/a');
    first();
    work.takeRecent();
    expect(work.takeRecent()).toEqual(['GET /api/a']);
  });
});

describe('startLagMonitor', () => {
  it('logs a warning naming the active request when a tick arrives late', () => {
    vi.useFakeTimers();
    let clock = 0;
    const lines: string[] = [];
    const work = new ActiveWork();
    const stop = startLagMonitor({
      processName: 'API',
      work,
      tickMs: 500,
      now: () => clock,
      log: (line) => lines.push(line),
    });
    clock = 500;
    vi.advanceTimersByTime(500);
    expect(lines).toEqual([]);
    const done = work.begin('GET /api/conversations/c1/audit/export.jsonl');
    clock = 1_900;
    done();
    vi.advanceTimersByTime(500);
    expect(lines).toEqual([
      'Event loop blocked for 900 ms in the API during GET /api/conversations/c1/audit/export.jsonl',
    ]);
    stop();
    clock = 9_000;
    vi.advanceTimersByTime(5_000);
    expect(lines).toHaveLength(1);
  });
});

describe('recentLagWarnings', () => {
  it('collects the latest warnings from every log in time order', () => {
    const logs = [
      {
        name: 'spark-outpost.1.log',
        text: '2026-10-01T10:00:00.000Z [api] Event loop blocked for 300 ms in the API during GET /a\n2026-10-01T10:00:01.000Z [api] ok\n',
        truncated: false,
      },
      {
        name: 'spark-outpost.log',
        text: '2026-10-01T11:00:00.000Z [worker] Event loop blocked for 900 ms in the worker during run r1\n',
        truncated: false,
      },
    ];
    expect(recentLagWarnings(logs)).toEqual([
      '2026-10-01T10:00:00.000Z [api] Event loop blocked for 300 ms in the API during GET /a',
      '2026-10-01T11:00:00.000Z [worker] Event loop blocked for 900 ms in the worker during run r1',
    ]);
    expect(recentLagWarnings(logs, 1)).toHaveLength(1);
  });
});

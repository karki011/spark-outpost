import { describe, expect, it } from 'vitest';
import type { NativeTerminalStep, NativeTerminalTurn } from '@spark-outpost/contracts';
import { stepDuration, stepRows } from './step-rows.ts';

const step = (extra: Partial<NativeTerminalStep>): NativeTerminalStep => ({
  id: 'toolu_1',
  name: 'Bash',
  agentId: null,
  startedAt: '2026-10-12T10:00:00.000Z',
  endedAt: '2026-10-12T10:00:01.500Z',
  failed: false,
  ...extra,
});
const turn = (
  status: NativeTerminalTurn['status'],
  steps: NativeTerminalStep[],
): NativeTerminalTurn => ({
  runId: '00000000-0000-4000-8000-000000000001',
  startedAt: '2026-10-12T10:00:00.000Z',
  status,
  model: null,
  tokens: null,
  costUsd: null,
  costSource: null,
  durationMs: null,
  steps,
});

describe('terminal step rows', () => {
  it('names the tool plainly and shows how long it took', () => {
    expect(stepRows(turn('succeeded', [step({})]))).toEqual([
      { id: 'toolu_1', name: 'Running a command', state: 'done', time: '1.5 s', subagent: false },
    ]);
  });

  it('marks a failed call, a running call and one whose end was never seen', () => {
    const open = step({ id: 'b', endedAt: null });
    expect(
      stepRows(turn('running', [step({ failed: true }), open])).map((row) => row.state),
    ).toEqual(['failed', 'active']);
    expect(stepRows(turn('cancelled', [open]))[0]).toMatchObject({ state: 'unknown', time: '' });
  });

  it('marks a sub-agent call and has no time without both ends', () => {
    expect(
      stepRows(turn('succeeded', [step({ agentId: 'a1', startedAt: null })]))[0],
    ).toMatchObject({ subagent: true, time: '' });
    expect(
      stepDuration({ startedAt: '2026-10-12T10:00:00.000Z', endedAt: '2026-10-12T10:00:00.250Z' }),
    ).toBe('250 ms');
    expect(
      stepDuration({ startedAt: '2026-10-12T10:00:00.000Z', endedAt: '2026-10-12T10:02:05.000Z' }),
    ).toBe('2m 5s');
  });
});

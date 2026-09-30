import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { toolOutputs } from './proxy.ts';
import type { StoryRecord, StoryRun } from './record.ts';
import { failingTests } from './repo.ts';
import { armStats, criteria } from './summary.ts';

function record(arm: StoryRecord['arm'], passed: boolean, wallMs: number, costUsd: number) {
  return {
    arm,
    ship: false,
    passed,
    wallMs,
    costUsd,
    interventions: [],
    userMinutes: passed ? 0 : 30,
    metrics: null,
    hiddenFailing: passed ? [] : ['the CSV export has a budget column after spent'],
    criticBeyondChecks: null,
  } as unknown as StoryRecord;
}

function storyRun(records: StoryRecord[]): StoryRun {
  return { rates: { hourlyUsd: 100, interventionMinutes: 1 }, records } as unknown as StoryRun;
}

describe('the story benchmark scoring', () => {
  it('prices a failed story at 30 minutes of the developer', () => {
    const stats = armStats(
      storyRun([record('a', true, 600_000, 2), record('a', false, 600_000, 2)]),
      'a',
    );
    expect(stats.passes).toBe(1);
    expect(stats.trueCostPerPassUsd).toBeCloseTo(54);
  });

  it('keeps parallel only when it is 30% faster at the same pass rate and cost', () => {
    const run = storyRun([
      record('a', true, 1_000_000, 2),
      record('c', true, 600_000, 2.2),
      record('b', true, 900_000, 2),
    ]);
    const [b, c] = criteria(run);
    expect(c!.verdict).toBe('keep');
    expect(b!.verdict).toBe('turn off');
  });

  it('turns pieces in order off when it fixes nothing one Builder got wrong', () => {
    const run = storyRun([record('a', true, 1_000, 1), record('a2', true, 1_000, 2)]);
    expect(criteria(run)[2]!.verdict).toBe('turn off');
  });
});

describe('the story helpers', () => {
  it('names the failing tests in TAP output', () => {
    const tap = 'ok 1 - first\nnot ok 2 - the bar is capped\n  ---\nnot ok 3 - csv\n';
    expect(failingTests(tap)).toEqual(['the bar is capped', 'csv']);
  });

  it('counts tool results in a compressed Responses request', () => {
    const body = JSON.stringify({
      input: [{ type: 'message' }, { type: 'function_call' }, { type: 'function_call_output' }],
    });
    expect(toolOutputs(zlib.zstdCompressSync(Buffer.from(body)), 'zstd')).toBe(1);
    expect(toolOutputs(Buffer.from('not json'), undefined)).toBe(-1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewMeetingLine } from '@spark-outpost/contracts';
import { fakeMeetingSource } from '../src/meetings/fake-source.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the fake meeting source', () => {
  it('is absent unless SPARK_FAKE_MEETINGS is 1', () => {
    expect(fakeMeetingSource({})).toBeNull();
    expect(fakeMeetingSource({ SPARK_FAKE_MEETINGS: '0' })).toBeNull();
  });

  it('delivers one searchable line per interval, alternating speakers', async () => {
    const source = fakeMeetingSource({
      SPARK_FAKE_MEETINGS: '1',
      SPARK_FAKE_MEETINGS_INTERVAL_MS: '100',
    })!;
    const delivered: NewMeetingLine[] = [];
    await source.start('m1', async (lines) => {
      delivered.push(...lines);
    });
    expect(delivered).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(100);
    expect(delivered).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(delivered.length).toBeGreaterThanOrEqual(8);
    expect(delivered.map((line) => line.speaker).slice(0, 4)).toEqual([
      'others',
      'you',
      'others',
      'you',
    ]);
    const text = delivered.map((line) => line.text).join(' ');
    expect(text).toContain('churn');
    expect(text).toContain('January');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('delivers nothing after stop and clears its timer', async () => {
    const source = fakeMeetingSource({ SPARK_FAKE_MEETINGS: '1' })!;
    const delivered: NewMeetingLine[] = [];
    await source.start('m1', async (lines) => {
      delivered.push(...lines);
    });
    await vi.advanceTimersByTimeAsync(150);
    expect(delivered).toHaveLength(1);
    await source.stop('m1');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(delivered).toHaveLength(1);
  });
});

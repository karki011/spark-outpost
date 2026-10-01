import { describe, expect, it } from 'vitest';
import {
  COMPACT_AT_RANGE_ERROR,
  COMPACT_GAP_ERROR,
  COMPACT_WARN_RANGE_ERROR,
  DEFAULT_COMPACTION_THRESHOLDS,
  compactionThresholdError,
  contextLevel,
  reaskPercent,
} from './compaction.ts';

describe('compactionThresholdError', () => {
  it('accepts the defaults and the edges of each range', () => {
    expect(compactionThresholdError(60, 80)).toBeNull();
    expect(compactionThresholdError(30, 40)).toBeNull();
    expect(compactionThresholdError(90, 95)).toBeNull();
  });

  it('rejects values outside the ranges', () => {
    expect(compactionThresholdError(29, 80)).toBe(COMPACT_WARN_RANGE_ERROR);
    expect(compactionThresholdError(91, 95)).toBe(COMPACT_WARN_RANGE_ERROR);
    expect(compactionThresholdError(30, 39)).toBe(COMPACT_AT_RANGE_ERROR);
    expect(compactionThresholdError(60, 96)).toBe(COMPACT_AT_RANGE_ERROR);
    expect(compactionThresholdError(60.5, 80)).toBe(COMPACT_WARN_RANGE_ERROR);
  });

  it('needs the warning at least 5 points below the compaction point', () => {
    expect(compactionThresholdError(76, 80)).toBe(COMPACT_GAP_ERROR);
    expect(compactionThresholdError(80, 80)).toBe(COMPACT_GAP_ERROR);
    expect(compactionThresholdError(75, 80)).toBeNull();
  });
});

describe('contextLevel', () => {
  it('uses the default 60% and 80%', () => {
    const at = (percent: number) => contextLevel(percent, DEFAULT_COMPACTION_THRESHOLDS);
    expect([at(10), at(59), at(60), at(79), at(80), at(100)]).toEqual([
      'ok',
      'ok',
      'warm',
      'warm',
      'hot',
      'hot',
    ]);
  });

  it('follows custom thresholds', () => {
    const custom = { warnPercent: 40, compactPercent: 50, autoCompact: false };
    expect(contextLevel(39, custom)).toBe('ok');
    expect(contextLevel(45, custom)).toBe('warm');
    expect(contextLevel(50, custom)).toBe('hot');
  });
});

describe('reaskPercent', () => {
  it('asks again 10 points later, never above 95%', () => {
    expect(reaskPercent(80)).toBe(90);
    expect(reaskPercent(40)).toBe(50);
    expect(reaskPercent(85)).toBe(95);
    expect(reaskPercent(90)).toBe(95);
  });
});

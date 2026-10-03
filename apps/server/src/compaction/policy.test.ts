import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPACTION_THRESHOLDS } from '@spark-outpost/contracts';
import {
  agentCompactWorked,
  compactStep,
  readingOf,
  selfCompacted,
  usedPercent,
} from './policy.ts';

const at = (percent: number) => ({ used: percent * 2_000, size: 200_000 });

describe('compactStep', () => {
  const base = {
    snoozed: false,
    cardPending: false,
    thresholds: DEFAULT_COMPACTION_THRESHOLDS,
  } as const;

  it('does nothing below the default 80%, or without a reading', () => {
    expect(compactStep({ ...base, reading: at(79) })).toBe('none');
    expect(compactStep({ ...base, reading: null })).toBe('none');
  });

  it('compacts by itself at the compaction point', () => {
    expect(compactStep({ ...base, reading: at(80) })).toBe('compact');
    expect(compactStep({ ...base, reading: at(90) })).toBe('compact');
  });

  it('waits for the compaction point plus 10 after Keep going', () => {
    const off = { ...DEFAULT_COMPACTION_THRESHOLDS, autoCompact: false };
    const snoozed = { ...base, thresholds: off, snoozed: true };
    expect(compactStep({ ...snoozed, reading: at(89) })).toBe('none');
    expect(compactStep({ ...snoozed, reading: at(90) })).toBe('ask');
  });

  it('follows custom thresholds and caps the second ask at 95%', () => {
    const late = { ...DEFAULT_COMPACTION_THRESHOLDS, warnPercent: 80, compactPercent: 90 };
    expect(compactStep({ ...base, thresholds: late, reading: at(89) })).toBe('none');
    expect(compactStep({ ...base, thresholds: late, reading: at(90) })).toBe('compact');
    const snoozed = { ...base, thresholds: late, snoozed: true };
    expect(compactStep({ ...snoozed, reading: at(94) })).toBe('none');
    expect(compactStep({ ...snoozed, reading: at(95) })).toBe('compact');
  });

  it('only asks when automatic compaction is off', () => {
    const off = { ...DEFAULT_COMPACTION_THRESHOLDS, autoCompact: false };
    expect(compactStep({ ...base, thresholds: off, reading: at(85) })).toBe('ask');
    expect(compactStep({ ...base, thresholds: off, reading: at(99) })).toBe('ask');
    expect(compactStep({ ...base, thresholds: off, reading: at(79) })).toBe('none');
  });

  it('never acts while another card is pending', () => {
    expect(compactStep({ ...base, cardPending: true, reading: at(99) })).toBe('none');
  });

  it('rounds the percentage the way the ring shows it', () => {
    expect(usedPercent({ used: 169_100, size: 200_000 })).toBe(85);
    expect(usedPercent({ used: 10, size: 0 })).toBe(0);
  });
});

describe('selfCompacted', () => {
  it('flags a drop of more than 40% between turns of one session', () => {
    expect(selfCompacted(at(80), at(40))).toBe(true);
    expect(selfCompacted(at(80), at(50))).toBe(false);
    expect(selfCompacted(at(80), at(85))).toBe(false);
  });

  it('needs both readings', () => {
    expect(selfCompacted(null, at(10))).toBe(false);
    expect(selfCompacted(at(80), null)).toBe(false);
    expect(selfCompacted({ used: 0, size: 200_000 }, at(10))).toBe(false);
  });
});

describe('agentCompactWorked', () => {
  it('needs a reported reading below 80% of the one before', () => {
    expect(agentCompactWorked(at(90), at(10))).toBe(true);
    expect(agentCompactWorked(at(90), at(80))).toBe(false);
    expect(agentCompactWorked(at(90), null)).toBe(false);
  });
});

describe('readingOf', () => {
  it('drops missing or empty readings', () => {
    expect(readingOf(10, 100)).toEqual({ used: 10, size: 100 });
    expect(readingOf(null, 100)).toBeNull();
    expect(readingOf(10, 0)).toBeNull();
  });
});

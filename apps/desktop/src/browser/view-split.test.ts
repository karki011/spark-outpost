import { describe, expect, it } from 'vitest';
import { SPLIT_RATIO_DEFAULT, clampSplitRatio, splitHolds } from '@spark-outpost/contracts';
import {
  splitAlive,
  splitForLink,
  splitFromMarks,
  splitMark,
  splitOf,
  splitSurvivor,
} from './view-split.ts';

const SPLIT = { leftTabId: 'a', rightTabId: 'b', ratio: 0.4 };

describe('a split of two tabs', () => {
  it('needs two different tabs', () => {
    expect(splitOf('a', 'a')).toBeNull();
    expect(splitOf('a', 'b')).toEqual({
      leftTabId: 'a',
      rightTabId: 'b',
      ratio: SPLIT_RATIO_DEFAULT,
    });
  });

  it('puts a link on the right, beside the tab it came from, keeping the ratio', () => {
    expect(splitForLink(null, 'c', 'n')).toEqual({
      leftTabId: 'c',
      rightTabId: 'n',
      ratio: SPLIT_RATIO_DEFAULT,
    });
    expect(splitForLink(SPLIT, 'b', 'n')).toEqual({ leftTabId: 'b', rightTabId: 'n', ratio: 0.4 });
  });

  it('ends when either side is gone and names the side that stays', () => {
    expect(splitAlive(SPLIT, ['a', 'b', 'c'])).toBe(true);
    expect(splitAlive(SPLIT, ['a', 'c'])).toBe(false);
    expect(splitSurvivor(SPLIT, ['a', 'c'])).toBe('a');
    expect(splitSurvivor(SPLIT, ['b'])).toBe('b');
    expect(splitSurvivor(SPLIT, ['c'])).toBeNull();
  });

  it('says which tabs it holds', () => {
    expect(splitHolds(SPLIT, 'a')).toBe(true);
    expect(splitHolds(SPLIT, 'c')).toBe(false);
    expect(splitHolds(null, 'a')).toBe(false);
  });

  it('comes back from the marks saved beside its tabs', () => {
    const marks = [
      { id: 'x', split: undefined },
      { id: 'r', split: splitMark({ ...SPLIT, rightTabId: 'r' }, 'r') },
      { id: 'l', split: { side: 'left', ratio: 0.4 } as const },
    ];
    expect(splitFromMarks(marks)).toEqual({ leftTabId: 'l', rightTabId: 'r', ratio: 0.4 });
  });

  it('does not come back when a side is missing or doubled', () => {
    const left = { side: 'left', ratio: 0.5 } as const;
    const right = { side: 'right', ratio: 0.5 } as const;
    expect(splitFromMarks([{ id: 'l', split: left }])).toBeNull();
    expect(
      splitFromMarks([
        { id: 'l', split: left },
        { id: 'm', split: left },
        { id: 'r', split: right },
      ]),
    ).toBeNull();
  });

  it('keeps each side wide enough for a page', () => {
    expect(clampSplitRatio(0.01)).toBe(0.15);
    expect(clampSplitRatio(0.99)).toBe(0.85);
    expect(clampSplitRatio(0.1, 1000)).toBe(0.28);
    expect(clampSplitRatio(0.9, 1000)).toBe(0.72);
    expect(clampSplitRatio(0.1, 400)).toBe(SPLIT_RATIO_DEFAULT);
    expect(clampSplitRatio(0.4567, 1000)).toBe(0.457);
  });
});

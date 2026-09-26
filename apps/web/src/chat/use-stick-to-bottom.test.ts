import { describe, expect, it } from 'vitest';
import { FOLLOW_THRESHOLD_PX, distanceFromBottom, nextFollowing } from './use-stick-to-bottom.ts';

const at = (scrollTop: number) => ({ scrollTop, scrollHeight: 2000, clientHeight: 600 });

describe('nextFollowing', () => {
  it('follows whenever the view is within the threshold of the bottom', () => {
    expect(distanceFromBottom(at(1400))).toBe(0);
    expect(nextFollowing(false, at(1400), 1400)).toBe(true);
    expect(nextFollowing(false, at(1400 - FOLLOW_THRESHOLD_PX), 1400)).toBe(true);
  });

  it('stops following when the reader scrolls up past the threshold', () => {
    expect(nextFollowing(true, at(1200), 1400)).toBe(false);
  });

  it('keeps following while content grows below a view that did not move up', () => {
    expect(nextFollowing(true, at(1200), 1200)).toBe(true);
  });

  it('stays detached while the reader scrolls down but is still far from the bottom', () => {
    expect(nextFollowing(false, at(900), 700)).toBe(false);
  });
});

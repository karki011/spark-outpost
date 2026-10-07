import { describe, expect, it } from 'vitest';
import { NO_ANCHOR, nextAnchorState, type AnchorEvent, type AnchorState } from './anchor-state.ts';

function run(events: readonly AnchorEvent[], from: AnchorState = NO_ANCHOR): AnchorState {
  return events.reduce(nextAnchorState, from);
}

const jumpTo = (anchor: string): AnchorEvent => ({ type: 'jump', anchor });
const band = (inView: string | null): AnchorEvent => ({ type: 'band', inView });
const scrollEnd = (landed: boolean, inView: string | null): AnchorEvent => ({
  type: 'scrollend',
  landed,
  inView,
});

describe('nextAnchorState', () => {
  it('follows the turn in the reading band while nothing is jumping', () => {
    expect(run([band('a'), band('b')])).toEqual({ active: 'b', jump: null });
  });

  it('keeps the current turn when the band is empty', () => {
    expect(run([band('a'), band(null)]).active).toBe('a');
  });

  it('holds the jump target while the thread travels past other turns', () => {
    expect(run([band('a'), jumpTo('d'), band('b'), band('c')]).active).toBe('d');
  });

  it('keeps a target that landed at the end of the thread outside the band', () => {
    const landed = run([band('a'), jumpTo('d'), band('b'), scrollEnd(true, 'b')]);
    expect(landed).toEqual({ active: 'd', jump: null });
  });

  it('lands the same way when the band reports after the scroll ends', () => {
    const landed = run([jumpTo('d'), scrollEnd(true, 'a'), band('d')]);
    expect(landed).toEqual({ active: 'd', jump: null });
  });

  it('follows the band again once the reader scrolls away from a landed jump', () => {
    expect(run([jumpTo('d'), scrollEnd(true, 'c'), band('a')]).active).toBe('a');
  });

  it('survives a scroll that ends early and then lands on the target', () => {
    const early = run([band('b'), jumpTo('d'), scrollEnd(false, 'b')]);
    expect(early).toEqual({ active: 'b', jump: { anchor: 'd', released: true } });
    expect(run([band('c'), scrollEnd(true, 'c')], early)).toEqual({ active: 'd', jump: null });
  });

  it('marks the turn in view when another scroll replaces the jump, in either order', () => {
    const scrollFirst = run([jumpTo('d'), band('c'), scrollEnd(false, 'c'), band('a')]);
    const bandFirst = run([jumpTo('d'), band('c'), band('a'), scrollEnd(false, 'a')]);
    expect(scrollFirst.active).toBe('a');
    expect(bandFirst.active).toBe('a');
  });

  it('lets a second jump replace one still in flight', () => {
    const second = run([jumpTo('b'), band('a'), jumpTo('d'), scrollEnd(false, 'b')]);
    expect(second.jump).toEqual({ anchor: 'd', released: true });
    expect(run([scrollEnd(true, 'c')], second)).toEqual({ active: 'd', jump: null });
  });

  it('follows the band as soon as the reader scrolls by hand', () => {
    const taken = run([jumpTo('d'), band('b'), { type: 'takeover', inView: 'b' }]);
    expect(taken).toEqual({ active: 'b', jump: { anchor: 'd', released: true } });
    expect(run([band('a'), scrollEnd(false, 'a')], taken).active).toBe('a');
  });

  it('still lands when a hand scroll did not stop the jump', () => {
    const taken = run([jumpTo('d'), { type: 'takeover', inView: 'b' }, band('c')]);
    expect(run([scrollEnd(true, 'c')], taken)).toEqual({ active: 'd', jump: null });
  });

  it('forgets a released jump after the timeout', () => {
    const forgotten = run([
      jumpTo('d'),
      { type: 'takeover', inView: 'b' },
      { type: 'timeout', landed: false, inView: 'a' },
    ]);
    expect(run([scrollEnd(true, 'a')], forgotten)).toEqual({ active: 'a', jump: null });
  });

  it('settles on a timeout when the thread never reports the end of a scroll', () => {
    const here = run([jumpTo('d'), { type: 'timeout', landed: true, inView: 'c' }]);
    const elsewhere = run([
      jumpTo('d'),
      band('a'),
      { type: 'timeout', landed: false, inView: 'a' },
    ]);
    expect(here).toEqual({ active: 'd', jump: null });
    expect(elsewhere).toEqual({ active: 'a', jump: null });
  });

  it('ignores the end of a scroll and a timeout when no jump is pending', () => {
    const idle = run([band('a')]);
    expect(run([scrollEnd(true, 'b')], idle)).toBe(idle);
    expect(run([{ type: 'timeout', landed: false, inView: 'b' }], idle)).toBe(idle);
  });
});

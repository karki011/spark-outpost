import { describe, expect, it } from 'vitest';
import { SETTLE_IDLE, settle, type SettleEvent } from './selection-settle.ts';

function run(events: SettleEvent[]): boolean[] {
  let state = SETTLE_IDLE;
  return events.map((event) => {
    const next = settle(state, event);
    state = next.state;
    return next.settled;
  });
}

describe('settle', () => {
  it('waits for the pointer to lift before a dragged selection settles', () => {
    expect(run(['pointer-down', 'changed', 'changed', 'changed', 'pointer-up'])).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it('does not settle on a click that changed nothing', () => {
    expect(run(['pointer-down', 'pointer-up'])).toEqual([false, false]);
  });

  it('settles at once for a selection made without the pointer', () => {
    expect(run(['changed'])).toEqual([true]);
  });

  it('settles a change reported after the pointer lifted', () => {
    expect(run(['pointer-down', 'changed', 'pointer-up', 'changed'])).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it('ignores a pointer lifted outside any press', () => {
    expect(run(['pointer-up', 'pointer-down', 'pointer-up'])).toEqual([false, false, false]);
  });
});

import { describe, expect, it } from 'vitest';
import { ignoreAnimationIterationListeners } from './animation-events.ts';

function fakeTarget() {
  const heard: string[] = [];
  return {
    heard,
    addEventListener(type: string, listener: () => void) {
      if (typeof listener === 'function') heard.push(type);
    },
  };
}

describe('ignoreAnimationIterationListeners', () => {
  it('drops listeners for animation iterations and keeps every other event', () => {
    const target = fakeTarget();
    ignoreAnimationIterationListeners(target);
    const listener = () => undefined;
    target.addEventListener('animationiteration', listener);
    target.addEventListener('animationend', listener);
    target.addEventListener('click', listener);
    expect(target.heard).toEqual(['animationend', 'click']);
  });

  it('passes the listener and its options through on the same target', () => {
    const calls: unknown[][] = [];
    const target = {
      addEventListener(this: unknown, ...args: unknown[]) {
        calls.push([this, ...args]);
      },
    };
    ignoreAnimationIterationListeners(target);
    const listener = () => undefined;
    target.addEventListener('pointermove', listener, { passive: true });
    expect(calls).toEqual([[target, 'pointermove', listener, { passive: true }]]);
  });
});

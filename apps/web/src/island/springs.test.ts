import { describe, expect, it } from 'vitest';
import { bezier, Spring } from './springs.ts';

function settle(spring: Spring, frames: number, dt = 1 / 60) {
  let now = 0;
  for (let frame = 0; frame < frames && spring.busy; frame++) {
    now += dt * 1000;
    spring.step(dt, now);
  }
  return now;
}

describe('island springs', () => {
  it('grows with a spring that settles exactly on target and then sleeps', () => {
    const spring = new Spring(190);
    spring.springTo(556);
    settle(spring, 240);
    expect(spring.busy).toBe(false);
    expect(spring.value).toBe(556);
  });

  it('stays stable when a frame is dropped', () => {
    const spring = new Spring(0);
    spring.springTo(100);
    spring.step(0.05, 50);
    expect(Number.isFinite(spring.value)).toBe(true);
    expect(spring.value).toBeLessThan(140);
  });

  it('shrinks along the close curve in 340 ms', () => {
    const spring = new Spring(556);
    spring.easeTo(190, 0);
    spring.step(0.016, 170);
    expect(spring.value).toBeGreaterThan(190);
    expect(spring.value).toBeLessThan(556);
    spring.step(0.016, 340);
    expect(spring.value).toBe(190);
    expect(spring.busy).toBe(false);
  });

  it('maps the bezier ends exactly', () => {
    const curve = bezier(0.45, 0, 0.2, 1);
    expect(curve(0)).toBeCloseTo(0, 3);
    expect(curve(1)).toBeCloseTo(1, 3);
  });
});

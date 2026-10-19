import { describe, expect, it } from 'vitest';
import { at, event, link } from '../test-fixtures.ts';
import { alertTitle, countdownSeconds, joinState, parsePlace, rigFor } from './alert-model.ts';

const standup = event('Standup', at(10), at(10, 15), { link: link('zoom') });
const design = event('Design sync', at(10), at(10, 30));

describe('alert card', () => {
  it('says when the meeting starts, then how long ago it started', () => {
    expect(alertTitle([standup], at(9, 59))).toBe('Standup starts in 1 min');
    expect(alertTitle([standup], at(10, 0, 30))).toBe('Standup starts now');
    expect(alertTitle([standup], at(10, 3))).toBe('Standup started 3 min ago');
    expect(alertTitle([standup, design], at(9, 59))).toBe('2 meetings start in 1 min');
  });

  it('offers Join only inside the join window and while the meeting runs', () => {
    expect(joinState(standup, at(9, 30))).toBe('later');
    expect(joinState(standup, at(9, 55))).toBe('open');
    expect(joinState(standup, at(10, 20))).toBe('none');
    expect(joinState(design, at(10))).toBe('none');
  });

  it('hangs the card under the menu bar, kept on screen near an edge', () => {
    const place = { anchorX: 760, top: 38, width: 1512, height: 982 };
    expect(rigFor(place)).toEqual({ x: 760, top: 38, drop: 355 });
    expect(rigFor({ ...place, anchorX: 20 }).x).toBe(216);
    expect(parsePlace({ anchorX: 1, width: 2, height: 3 })).toBeNull();
  });

  it('counts the automatic join down in whole seconds', () => {
    expect(countdownSeconds(10_000, 500)).toBe(10);
    expect(countdownSeconds(10_000, 12_000)).toBe(0);
  });
});

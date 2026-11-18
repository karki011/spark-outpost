import { describe, expect, it } from 'vitest';
import { isHiddenView } from './saved-view.ts';

const MAC = { phone: false, remote: false, browser: true };

describe('isHiddenView', () => {
  it('shows every view on the Mac', () => {
    expect(isHiddenView('github', MAC)).toBe(false);
    expect(isHiddenView('today', MAC)).toBe(false);
    expect(isHiddenView('browser', MAC)).toBe(false);
  });

  it('hides the Mac-only views on a paired device', () => {
    const remote = { ...MAC, remote: true };
    expect(isHiddenView('github', remote)).toBe(true);
    expect(isHiddenView('today', remote)).toBe(true);
    expect(isHiddenView('browser', remote)).toBe(true);
    expect(isHiddenView('tickets', remote)).toBe(false);
  });

  it('hides the map and the browser at phone width, and the browser without its host', () => {
    expect(isHiddenView('map', { ...MAC, phone: true })).toBe(true);
    expect(isHiddenView('browser', { ...MAC, browser: false })).toBe(true);
    expect(isHiddenView('github', { ...MAC, phone: true })).toBe(false);
  });
});

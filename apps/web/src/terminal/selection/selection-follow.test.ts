import { describe, expect, it } from 'vitest';
import { followOutcome, isScrollKey, rowsInView } from './selection-follow.ts';

const shown = { shown: true, selected: true, inView: true };

describe('followOutcome', () => {
  it('hides the toolbar when the user scrolls, types or resizes', () => {
    expect(followOutcome('user-scroll', shown)).toBe('hide');
    expect(followOutcome('input', shown)).toBe('hide');
    expect(followOutcome('resize', shown)).toBe('hide');
  });

  it('moves the toolbar with the selection when output arrives', () => {
    expect(followOutcome('output', shown)).toBe('move');
  });

  it('hides it when output scrolls the selection out of view or clears it', () => {
    expect(followOutcome('output', { ...shown, inView: false })).toBe('hide');
    expect(followOutcome('output', { ...shown, selected: false })).toBe('hide');
  });

  it('does nothing while no toolbar is shown, and never shows one', () => {
    for (const event of ['user-scroll', 'input', 'resize', 'output'] as const) {
      expect(followOutcome(event, { ...shown, shown: false })).toBe('keep');
    }
  });
});

describe('rowsInView', () => {
  it('counts a selection with any row on screen as in view', () => {
    expect(rowsInView(10, 12, 0, 24)).toBe(true);
    expect(rowsInView(10, 12, 12, 24)).toBe(true);
    expect(rowsInView(30, 31, 7, 24)).toBe(true);
  });

  it('counts a selection above or below the screen as out of view', () => {
    expect(rowsInView(10, 12, 13, 24)).toBe(false);
    expect(rowsInView(40, 41, 0, 24)).toBe(false);
  });
});

describe('isScrollKey', () => {
  it('knows the keys that scroll the terminal', () => {
    expect(isScrollKey({ key: 'PageUp', shiftKey: true })).toBe(true);
    expect(isScrollKey({ key: 'End', shiftKey: true })).toBe(true);
    expect(isScrollKey({ key: 'PageUp', shiftKey: false })).toBe(false);
    expect(isScrollKey({ key: 'a', shiftKey: true })).toBe(false);
  });
});

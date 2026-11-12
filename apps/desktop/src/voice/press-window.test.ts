import { describe, expect, it } from 'vitest';
import { pressWindow, type SparkWindow } from './press-window.ts';

const main: SparkWindow = { id: 1, island: false, focused: true, onScreen: true };
const island: SparkWindow = { id: 2, island: true, focused: false, onScreen: true };
const target = (id: number) => id === 1;

describe('where a voice press goes', () => {
  it('goes to the focused Spark window when it has a message box', () => {
    expect(pressWindow([main, island], true, target)).toBe(1);
  });

  it('goes to the island when the focused Spark window has no message box', () => {
    expect(pressWindow([main, island], true, () => false)).toBeNull();
  });

  it('goes to the island while the island itself is focused', () => {
    const windows = [
      { ...main, focused: false },
      { ...island, focused: true },
    ];
    expect(pressWindow(windows, true, target)).toBeNull();
  });

  it('still reaches the Spark window after the island gave focus up and no window took it', () => {
    const windows = [{ ...main, focused: false }, island];
    expect(pressWindow(windows, true, target)).toBe(1);
  });

  it('goes to the island when another app is in front', () => {
    const windows = [{ ...main, focused: false }, island];
    expect(pressWindow(windows, false, target)).toBeNull();
  });

  it('ignores a Spark window that is hidden or minimised', () => {
    const windows = [{ ...main, focused: false, onScreen: false }, island];
    expect(pressWindow(windows, true, target)).toBeNull();
  });
});

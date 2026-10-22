// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APPEARANCE_KEY, followAppearance, readAppearance, saveAppearance } from './appearance.ts';

type Listener = () => void;

const media = new Map<string, { matches: boolean; listeners: Set<Listener> }>();

function setSystem(query: string, matches: boolean): void {
  const entry = media.get(query) ?? { matches, listeners: new Set<Listener>() };
  entry.matches = matches;
  media.set(query, entry);
  entry.listeners.forEach((listener) => listener());
}

beforeEach(() => {
  media.clear();
  setSystem('(prefers-color-scheme: dark)', false);
  setSystem('(prefers-contrast: more)', false);
  window.matchMedia = ((query: string) => {
    const entry = media.get(query) ?? { matches: false, listeners: new Set<Listener>() };
    media.set(query, entry);
    return {
      get matches() {
        return entry.matches;
      },
      addEventListener: (_: string, listener: Listener) => entry.listeners.add(listener),
      removeEventListener: (_: string, listener: Listener) => entry.listeners.delete(listener),
    };
  }) as unknown as typeof window.matchMedia;
  localStorage.clear();
  delete document.documentElement.dataset.skin;
  delete document.documentElement.dataset.island;
});

afterEach(() => localStorage.clear());

describe('following the system appearance', () => {
  it('switches sides when the Mac switches between light and dark', () => {
    const stop = followAppearance();
    expect(document.documentElement.dataset.skin).toBe('light');
    setSystem('(prefers-color-scheme: dark)', true);
    expect(document.documentElement.dataset.skin).toBe('graphite');
    setSystem('(prefers-contrast: more)', true);
    expect(document.documentElement.dataset.skin).toBe('contrast-dark');
    stop();
    setSystem('(prefers-contrast: more)', false);
    expect(document.documentElement.dataset.skin).toBe('contrast-dark');
  });

  it('picks up a choice another window saved', () => {
    const stop = followAppearance();
    localStorage.setItem(APPEARANCE_KEY, 'dark.apricot.system');
    window.dispatchEvent(new StorageEvent('storage', { key: APPEARANCE_KEY }));
    expect(document.documentElement.dataset.skin).toBe('plum');
    stop();
  });

  it('keeps the island on the dark side of the tint', () => {
    document.documentElement.dataset.island = '';
    saveAppearance({ mode: 'light', tint: 'lagoon', contrast: 'system' });
    expect(document.documentElement.dataset.skin).toBe('moss');
  });

  it('saves the choice in the new format and reads it back', () => {
    saveAppearance({ mode: 'dark', tint: 'sage', contrast: 'always' });
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('dark.sage.always');
    expect(readAppearance()).toEqual({ mode: 'dark', tint: 'sage', contrast: 'always' });
    expect(document.documentElement.dataset.skin).toBe('contrast-dark');
  });
});

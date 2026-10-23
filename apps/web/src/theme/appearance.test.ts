// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APPEARANCE_KEY, followAppearance, readAppearance, saveAppearance } from './appearance.ts';
import { useAppearance, withChange } from './use-appearance.ts';

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

  it('sets the browser bar colour on load even when the boot script already set the skin', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#eaecf0" />';
    localStorage.setItem(APPEARANCE_KEY, 'dark.sage.system');
    document.documentElement.dataset.skin = 'loam';
    document.documentElement.style.setProperty('--rail', '#0d0c08');
    const stop = followAppearance();
    expect(document.querySelector('meta')?.getAttribute('content')).toBe('#0d0c08');
    stop();
    document.documentElement.style.removeProperty('--rail');
  });

  it('merges a change with the latest saved choice, wherever it was made', () => {
    const { result } = renderHook(() => useAppearance());
    act(() => saveAppearance({ mode: 'auto', tint: 'sage', contrast: 'always' }));
    expect(result.current).toEqual({ mode: 'auto', tint: 'sage', contrast: 'always' });
    expect(withChange({ mode: 'dark' })).toEqual({
      mode: 'dark',
      tint: 'sage',
      contrast: 'always',
    });
    act(() => {
      localStorage.setItem(APPEARANCE_KEY, 'light.iris.system');
      window.dispatchEvent(new StorageEvent('storage', { key: APPEARANCE_KEY }));
    });
    expect(result.current.tint).toBe('iris');
  });
});

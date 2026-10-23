import { describe, expect, it } from 'vitest';
import { sameFavoritePage } from './browser-view.ts';

describe('sameFavoritePage', () => {
  it('treats a page as saved after its hash, query or trailing slash changes', () => {
    const saved = 'https://docs.example.com/guide';
    expect(sameFavoritePage(saved, 'https://docs.example.com/guide#install')).toBe(true);
    expect(sameFavoritePage(saved, 'https://docs.example.com/guide?tab=mac')).toBe(true);
    expect(sameFavoritePage(saved, 'https://docs.example.com/guide/')).toBe(true);
  });

  it('keeps other pages and other sites apart', () => {
    const saved = 'https://docs.example.com/guide';
    expect(sameFavoritePage(saved, 'https://docs.example.com/api')).toBe(false);
    expect(sameFavoritePage(saved, 'https://example.com/guide')).toBe(false);
    expect(sameFavoritePage('about:blank', 'about:blank')).toBe(true);
  });
});

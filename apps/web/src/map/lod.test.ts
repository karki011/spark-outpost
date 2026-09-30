import { describe, expect, it } from 'vitest';
import { drawBudget, loadRequests, placeholderStars, wantedFiles } from './lod.ts';
import { FIRST_PAGE } from './map-api.ts';

describe('level of detail', () => {
  it('loads nothing for tiny areas, a first page when visible and everything up close', () => {
    expect(wantedFiles(10, 900)).toBe(0);
    expect(wantedFiles(60, 900)).toBe(FIRST_PAGE);
    expect(wantedFiles(60, 40)).toBe(40);
    expect(wantedFiles(400, 900)).toBe(900);
  });

  it('draws more files as an area grows on screen, never more than are loaded', () => {
    expect(drawBudget(30, 500)).toBeLessThan(drawBudget(200, 500));
    expect(drawBudget(2000, 500)).toBe(500);
    expect(drawBudget(1, 3)).toBe(3);
  });

  it('asks for the biggest visible areas first and skips loaded or in-flight ones', () => {
    const requests = loadRequests(
      [
        { key: 'a', screenRadius: 50, fileCount: 300, loaded: 0, visible: true },
        { key: 'b', screenRadius: 90, fileCount: 300, loaded: 0, visible: true },
        { key: 'c', screenRadius: 90, fileCount: 300, loaded: 0, visible: false },
        { key: 'd', screenRadius: 90, fileCount: 300, loaded: FIRST_PAGE, visible: true },
        { key: 'e', screenRadius: 90, fileCount: 300, loaded: 0, visible: true },
      ],
      new Set(['e']),
      8,
    );
    expect(requests).toEqual([
      { key: 'b', limit: FIRST_PAGE },
      { key: 'a', limit: FIRST_PAGE },
    ]);
  });

  it('places the same placeholder stars for the same area every time', () => {
    expect(placeholderStars('area', 5, 30)).toEqual(placeholderStars('area', 5, 30));
    for (const [x, y] of placeholderStars('area', 50, 30))
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(30);
  });
});

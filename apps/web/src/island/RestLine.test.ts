import { describe, expect, it } from 'vitest';
import { islandStatus, scoutLabel } from './RestLine.tsx';

describe('what the island says it holds', () => {
  it('names a set-aside request as set aside, never as needing you', () => {
    expect(islandStatus(0, 1, 0)).toBe('1 set aside');
    expect(scoutLabel(0, 1)).toBe('Spark: 1 set aside. Open Spark Island');
  });

  it('counts requests, set-aside items and working chats, or says all quiet', () => {
    expect(islandStatus(2, 1, 3)).toBe('2 need you, 1 set aside, 3 working');
    expect(islandStatus(0, 0, 0)).toBe('all quiet');
  });
});

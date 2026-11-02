import { describe, expect, it } from 'vitest';
import { changesOrder, dropBefore, keyedBefore, movedLine } from './tab-order.ts';

const edges = [
  { id: 'a', start: 0, end: 100 },
  { id: 'b', start: 100, end: 200 },
  { id: 'c', start: 200, end: 300 },
];

describe('tab order', () => {
  it('drops before the first tab whose middle is past the pointer', () => {
    expect(dropBefore(edges, 10)).toBe('a');
    expect(dropBefore(edges, 60)).toBe('b');
    expect(dropBefore(edges, 160)).toBe('c');
    expect(dropBefore(edges, 260)).toBeNull();
  });

  it('knows when a drop leaves the order as it was', () => {
    const ids = ['a', 'b', 'c'];
    expect(changesOrder(ids, 'a', 'a')).toBe(false);
    expect(changesOrder(ids, 'a', 'b')).toBe(false);
    expect(changesOrder(ids, 'c', null)).toBe(false);
    expect(changesOrder(ids, 'a', 'c')).toBe(true);
    expect(changesOrder(ids, 'a', null)).toBe(true);
    expect(changesOrder(ids, 'x', 'a')).toBe(false);
  });

  it('moves one place by key and stops at the ends', () => {
    const ids = ['a', 'b', 'c'];
    expect(keyedBefore(ids, 'a', 1)).toBe('c');
    expect(keyedBefore(ids, 'b', 1)).toBeNull();
    expect(keyedBefore(ids, 'c', -1)).toBe('b');
    expect(keyedBefore(ids, 'c', 1)).toBeUndefined();
    expect(keyedBefore(ids, 'a', -1)).toBeUndefined();
  });

  it('says where the tab went', () => {
    expect(movedLine('Docs', 2, 4)).toBe('Moved Docs to position 2 of 4');
  });
});

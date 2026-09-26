import { describe, expect, it } from 'vitest';
import {
  LOOSE,
  chatDrop,
  landing,
  listIn,
  pinnedIn,
  placed,
  position,
  sorted,
  type Layout,
} from './sidebar-order.ts';

const layout: Layout = {
  [pinnedIn('web')]: ['wp'],
  [listIn('web')]: ['w1', 'w2'],
  [pinnedIn('docs')]: [],
  [listIn('docs')]: ['d1'],
  [pinnedIn('none')]: ['lp'],
  [LOOSE]: ['l1', 'l2'],
};

describe('landing', () => {
  it('lands an unpinned chat above or below the chat it hovers in another project', () => {
    expect(landing(layout, 'l1', false, { kind: 'chat', id: 'w2', below: false })).toEqual({
      container: listIn('web'),
      index: 1,
    });
    expect(landing(layout, 'l1', false, { kind: 'chat', id: 'w2', below: true })).toEqual({
      container: listIn('web'),
      index: 2,
    });
  });

  it('keeps pinned chats in the pinned section of the project they enter', () => {
    expect(landing(layout, 'lp', true, { kind: 'chat', id: 'w1', below: false })).toEqual({
      container: pinnedIn('web'),
      index: 1,
    });
    expect(landing(layout, 'w1', false, { kind: 'chat', id: 'wp', below: false })).toBeNull();
    expect(landing(layout, 'd1', false, { kind: 'chat', id: 'wp', below: true })).toEqual({
      container: listIn('web'),
      index: 0,
    });
  });

  it('uses the project header for the top and the rest of the block for the end', () => {
    expect(landing(layout, 'l1', false, { kind: 'project', projectId: 'web', top: true })).toEqual({
      container: listIn('web'),
      index: 0,
    });
    expect(landing(layout, 'l1', false, { kind: 'project', projectId: 'web', top: false })).toEqual(
      { container: listIn('web'), index: 2 },
    );
    expect(
      landing(layout, 'w1', false, { kind: 'project', projectId: 'web', top: true }),
    ).toBeNull();
  });

  it('sends chats out of a project into the date-bucketed loose chats', () => {
    expect(landing(layout, 'w1', false, { kind: 'loose' })).toEqual({ container: LOOSE, index: 2 });
    expect(landing(layout, 'w1', false, { kind: 'chat', id: 'l2', below: false })).toEqual({
      container: LOOSE,
      index: 1,
    });
    expect(landing(layout, 'l1', false, { kind: 'loose' })).toBeNull();
  });

  it('ignores the dragged chat itself and unknown chats', () => {
    expect(landing(layout, 'w1', false, { kind: 'chat', id: 'w1', below: false })).toBeNull();
    expect(landing(layout, 'gone', false, { kind: 'loose' })).toBeNull();
  });
});

describe('drops', () => {
  it('reports a move with the full order of the sortable list it lands in', () => {
    const end = placed(layout, 'l1', { container: listIn('web'), index: 1 });
    expect(end[LOOSE]).toEqual(['l2']);
    expect(chatDrop(layout, end, 'l1')).toEqual({
      chatId: 'l1',
      from: LOOSE,
      to: listIn('web'),
      order: ['w1', 'l1', 'w2'],
    });
    expect(position(end, 'l1')).toEqual({ index: 2, count: 3 });
  });

  it('reports a reorder inside one list and nothing when the order is unchanged', () => {
    const end = sorted(layout, 'w1', 'w2');
    expect(chatDrop(layout, end, 'w1')).toEqual({
      chatId: 'w1',
      from: listIn('web'),
      to: listIn('web'),
      order: ['w2', 'w1'],
    });
    expect(chatDrop(layout, layout, 'w1')).toBeNull();
    expect(sorted(layout, 'l1', 'l2')).toBe(layout);
  });

  it('moves into loose chats without an order', () => {
    const end = placed(layout, 'w2', { container: LOOSE, index: 0 });
    expect(chatDrop(layout, end, 'w2')).toEqual({
      chatId: 'w2',
      from: listIn('web'),
      to: LOOSE,
      order: null,
    });
  });
});

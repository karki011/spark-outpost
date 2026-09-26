import { describe, expect, it } from 'vitest';
import { firstLoose, projected, tailProject, type ProjectionInput } from './sidebar-projection.ts';
import { LOOSE, containerOf, listIn, pinnedIn, type Layout } from './sidebar-order.ts';

const layout: Layout = {
  [pinnedIn('web')]: ['wp'],
  [listIn('web')]: ['w1', 'w2'],
  [pinnedIn('docs')]: ['dp'],
  [listIn('docs')]: [],
  [pinnedIn('none')]: [],
  [LOOSE]: ['old', 'new'],
};

const updated: Record<string, string> = {
  old: '2026-01-01T00:00:00Z',
  new: '2026-09-01T00:00:00Z',
};

const input = (chatId: string, pinned = false, base: Layout = layout): ProjectionInput => ({
  layout: base,
  chatId,
  pinned,
  projectIds: ['web', 'docs'],
  updatedAt: (id) => updated[id] ?? '',
});

describe('tailProject', () => {
  it('finds the project whose last visible chat is the given chat', () => {
    expect(tailProject(layout, 'w2')).toBe('web');
    expect(tailProject(layout, 'w1')).toBeNull();
    expect(tailProject(layout, 'wp')).toBeNull();
    expect(tailProject(layout, 'dp')).toBe('docs');
    expect(tailProject(layout, 'new')).toBeNull();
  });
});

describe('firstLoose', () => {
  it('prefers the first pinned loose chat, then the newest loose chat', () => {
    expect(firstLoose(layout, (id) => updated[id] ?? '')).toBe('new');
    const pinned = { ...layout, [pinnedIn('none')]: ['lp'] };
    expect(firstLoose(pinned, (id) => updated[id] ?? '')).toBe('lp');
  });
});

describe('projected', () => {
  it('moves the last chat of a project out to the loose chats', () => {
    const out = projected(input('w2'), 'out');
    expect(out?.group).toBe('none');
    expect(containerOf(out!.layout, 'w2')).toBe(LOOSE);
  });

  it('keeps a pinned chat pinned when it moves out', () => {
    const out = projected(input('dp', true), 'out');
    expect(out?.layout[pinnedIn('none')]).toEqual(['dp']);
  });

  it('only moves a chat out from the last position of its project', () => {
    expect(projected(input('w1'), 'out')).toBeNull();
    expect(projected(input('new'), 'out')).toBeNull();
  });

  it('moves the first loose chat into the end of the last project', () => {
    const into = projected(input('new'), 'in');
    expect(into?.group).toBe('docs');
    expect(into?.layout[listIn('docs')]).toEqual(['new']);
    expect(projected(input('old'), 'in')).toBeNull();
    expect(projected(input('w2'), 'in')).toBeNull();
  });

  it('keeps a pinned loose chat among the pinned chats of the project', () => {
    const base = { ...layout, [pinnedIn('none')]: ['lp'] };
    const into = projected(input('lp', true, base), 'in');
    expect(into?.layout[pinnedIn('docs')]).toEqual(['dp', 'lp']);
  });
});

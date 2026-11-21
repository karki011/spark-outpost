import { describe, expect, it } from 'vitest';
import type { ConversationSummary, SubChatStatus } from '@spark-outpost/contracts';
import {
  flatTree,
  leavingDeletedParents,
  markedTitle,
  nameInParent,
  needsYouCount,
  needsYouLabel,
  parentMarkText,
  subChatCountLabel,
  subChatTree,
  treePlacement,
} from './sub-chat-tree.ts';

const ARCHIVED = '2026-11-19T09:00:00.000Z';

const chat = (id: string, extra: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id,
  title: id,
  updatedAt: '2026-11-20T10:00:00.000Z',
  projectIds: [],
  latestRun: null,
  archivedAt: null,
  pinnedAt: null,
  pinnedOrder: null,
  projectOrder: null,
  unread: false,
  needsInput: false,
  attention: null,
  titleSource: 'message',
  category: null,
  ...extra,
});

const sub = (
  id: string,
  position: number,
  status: SubChatStatus = 'working',
  extra: Partial<ConversationSummary> = {},
): ConversationSummary =>
  chat(id, {
    parent: { id: 'parent', title: 'Checkout rewrite' },
    subChat: { position, status },
    ...extra,
  });

const ids = (chats: readonly ConversationSummary[] | undefined) => chats?.map((c) => c.id);

describe('subChatTree', () => {
  it('nests sub-chats under their parent in plan order and keeps them out of the roots', () => {
    const tree = subChatTree([
      sub('tests', 3),
      chat('other'),
      sub('api', 0),
      chat('parent', { subChatCount: 3 }),
      sub('ui', 2),
    ]);
    expect(ids(tree.roots)).toEqual(['other', 'parent']);
    expect(ids(tree.subs.get('parent'))).toEqual(['api', 'ui', 'tests']);
  });

  it('leaves a sub-chat at the top when its parent is not listed', () => {
    const tree = subChatTree([sub('api', 0), chat('other')]);
    expect(ids(tree.roots)).toEqual(['api', 'other']);
    expect(tree.subs.size).toBe(0);
  });

  it('leaves a sub-chat at the top when its parent is archived', () => {
    const tree = subChatTree([chat('parent', { archivedAt: ARCHIVED }), sub('api', 0)]);
    expect(ids(tree.roots)).toEqual(['parent', 'api']);
    expect(tree.subs.size).toBe(0);
  });

  it('keeps an archived sub-chat out of the tree', () => {
    const tree = subChatTree([
      chat('parent'),
      sub('api', 0),
      sub('ui', 1, 'done', { archivedAt: ARCHIVED }),
    ]);
    expect(ids(tree.roots)).toEqual(['parent', 'ui']);
    expect(ids(tree.subs.get('parent'))).toEqual(['api']);
  });

  it('keeps a chat whose parent was deleted at the top', () => {
    const orphan = chat('index', {
      formerParent: { title: 'Catalog cleanup' },
      subChat: { position: 0, status: 'done' },
    });
    const tree = subChatTree([orphan, chat('parent')]);
    expect(ids(tree.roots)).toEqual(['index', 'parent']);
  });

  it('never nests under a chat that is itself a sub-chat', () => {
    const middle = sub('parent', 0, 'working', { parent: { id: 'top', title: 'Top' } });
    const tree = subChatTree([middle, sub('api', 0)]);
    expect(ids(tree.roots)).toEqual(['parent', 'api']);
  });
});

describe('flatTree', () => {
  it('lists every chat at the top', () => {
    const tree = flatTree([chat('parent'), sub('api', 0)]);
    expect(ids(tree.roots)).toEqual(['parent', 'api']);
    expect(tree.subs.size).toBe(0);
  });
});

describe('needs-you count', () => {
  it('counts only sub-chats that need the user', () => {
    const subs = [sub('a', 0, 'needs_you'), sub('b', 1, 'working'), sub('c', 2, 'needs_you')];
    expect(needsYouCount(subs)).toBe(2);
    expect(needsYouCount([sub('b', 0, 'held')])).toBe(0);
  });

  it('words one and several', () => {
    expect(needsYouLabel(1)).toBe('1 sub-chat needs you');
    expect(needsYouLabel(3)).toBe('3 sub-chats need you');
    expect(subChatCountLabel(1)).toBe('1 sub-chat');
    expect(subChatCountLabel(4)).toBe('4 sub-chats');
  });
});

describe('treePlacement', () => {
  it('changes when a sub-chat moves into or out of the tree', () => {
    const nested = treePlacement(subChatTree([chat('parent'), sub('api', 0)]));
    const flat = treePlacement(flatTree([chat('parent'), sub('api', 0)]));
    expect(nested).toBe('api:parent');
    expect(flat).toBe('');
  });
});

describe('flattened wording', () => {
  it('marks a sub-chat with its parent', () => {
    expect(parentMarkText(sub('api', 0))).toBe('↳ Checkout rewrite');
    expect(markedTitle(sub('api', 0))).toBe('api ↳ Checkout rewrite');
    expect(nameInParent(sub('api', 0))).toBe('api in Checkout rewrite');
  });

  it('reads was part of while its parent waits out the Undo of a delete', () => {
    const parent = chat('parent', { title: 'Checkout rewrite' });
    const listed = leavingDeletedParents(
      [parent, sub('api', 0), chat('other')],
      new Set(['parent']),
    );
    expect(listed.map((each) => each.id)).toEqual(['api', 'other']);
    expect(listed[0]?.parent).toBeUndefined();
    expect(parentMarkText(listed[0]!)).toBe('· was part of Checkout rewrite');
    expect(leavingDeletedParents([parent, sub('api', 0)], new Set())).toEqual([
      parent,
      sub('api', 0),
    ]);
  });

  it('says what a chat was part of once its parent is deleted', () => {
    const orphan = chat('index', { formerParent: { title: 'Catalog cleanup' } });
    expect(parentMarkText(orphan)).toBe('· was part of Catalog cleanup');
    expect(markedTitle(orphan)).toBe('index · was part of Catalog cleanup');
    expect(nameInParent(orphan)).toBe('index');
  });

  it('leaves an ordinary chat alone', () => {
    expect(parentMarkText(chat('plain'))).toBeNull();
    expect(markedTitle(chat('plain'))).toBe('plain');
  });
});

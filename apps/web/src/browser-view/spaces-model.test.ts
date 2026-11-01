import { describe, expect, it } from 'vitest';
import {
  browserSpaceKey,
  wanderedFromPinned,
  type BrowserPaneTab,
  type BrowserViewLayout,
} from '@spark-outpost/contracts';
import { barRows, barSections } from './command-bar-model.ts';
import { chromeSpaceIndex, pinnedGroups, tabsInCurrentSpace } from './spaces-model.ts';

const tab = (id: string, pinned = false) => ({ id, pinned }) as BrowserPaneTab;

const layout: BrowserViewLayout = {
  spaces: [
    { id: 's1', name: 'One', icon: 'home', color: 'accent' },
    { id: 's2', name: 'Two', icon: 'book', color: 'muted' },
  ],
  currentSpaceId: 's1',
  folders: [
    { id: 'f1', spaceId: 's1', name: 'Refs', collapsed: false },
    { id: 'f2', spaceId: 's2', name: 'Other', collapsed: false },
  ],
  places: [
    { tabId: 'a', spaceId: 's1', folderId: 'f1', pinnedUrl: 'https://a.example/' },
    { tabId: 'b', spaceId: 's1', folderId: null, pinnedUrl: 'https://b.example/' },
    { tabId: 'c', spaceId: 's2', folderId: 'f2', pinnedUrl: 'https://c.example/' },
    { tabId: 'd', spaceId: 's1', folderId: 'gone', pinnedUrl: 'https://d.example/' },
  ],
  archived: [],
};

describe('Spaces in the tab list', () => {
  it('lists the current Space’s tabs, and a tab with no place yet', () => {
    const tabs = ['a', 'c', 'new'].map((id) => tab(id));
    expect(tabsInCurrentSpace(tabs, layout).map((item) => item.id)).toEqual(['a', 'new']);
  });

  it('groups pinned tabs by folder, with an unknown folder left loose', () => {
    const tabs = [tab('a', true), tab('b', true), tab('d', true), tab('e')];
    const groups = pinnedGroups(tabs, layout);
    expect(groups.loose.map((item) => item.id)).toEqual(['b', 'd']);
    expect(groups.folders.map((group) => group.folder.id)).toEqual(['f1']);
    expect(groups.folders[0]!.tabs.map((item) => item.id)).toEqual(['a']);
  });
});

describe('the Space key', () => {
  const chord = {
    code: 'Digit3',
    meta: false,
    ctrl: true,
    shift: false,
    alt: false,
    composing: false,
  };

  it('is ⌃1 to ⌃9 on a Mac only, with no other modifier', () => {
    expect(browserSpaceKey(chord, true)).toBe(2);
    expect(browserSpaceKey({ ...chord, code: 'Digit0' }, true)).toBeNull();
    expect(browserSpaceKey({ ...chord, code: 'KeyT' }, true)).toBeNull();
    expect(browserSpaceKey({ ...chord, meta: true }, true)).toBeNull();
    expect(browserSpaceKey({ ...chord, shift: true }, true)).toBeNull();
    expect(browserSpaceKey({ ...chord, alt: true }, true)).toBeNull();
    expect(browserSpaceKey({ ...chord, composing: true }, true)).toBeNull();
    expect(browserSpaceKey(chord, false)).toBeNull();
  });

  it('reads a chrome key event', () => {
    const event = {
      code: 'Digit1',
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      keyCode: 49,
      nativeEvent: { isComposing: false },
    };
    expect(chromeSpaceIndex(event, true)).toBe(0);
    expect(chromeSpaceIndex({ ...event, keyCode: 229 }, true)).toBeNull();
  });
});

describe('a pinned tab’s address', () => {
  const pinned = 'https://example.com/app?view=a';

  it('has wandered when the path or query differs', () => {
    expect(wanderedFromPinned('https://example.com/app?view=b', pinned)).toBe(true);
    expect(wanderedFromPinned('https://example.com/other', pinned)).toBe(true);
    expect(wanderedFromPinned('https://other.example/app?view=a', pinned)).toBe(true);
  });

  it('has not for a fragment, a trailing slash, a blank tab or no pinned address', () => {
    expect(wanderedFromPinned(`${pinned}#top`, pinned)).toBe(false);
    expect(wanderedFromPinned('https://example.com/app/?view=a', pinned)).toBe(false);
    expect(wanderedFromPinned('', pinned)).toBe(false);
    expect(wanderedFromPinned('https://example.com/', null)).toBe(false);
  });
});

describe('Archived in the command bar', () => {
  const archived = [
    { id: 'x1', url: 'https://news.example.com/a', title: 'Old news', archivedAt: 0 },
  ];
  const input = {
    tabs: [],
    favorites: [],
    history: [],
    archived,
    page: false,
    search: null,
  };

  it('offers an archived tab and finds it by title or address', () => {
    const rows = barRows({ ...input, text: 'old' }, 2 * 60 * 60_000);
    const row = rows.find((item) => item.group === 'archived')!;
    expect(row.target).toEqual({ kind: 'archived', id: 'x1' });
    expect(row.detail).toBe('news.example.com · archived 2 h ago');
    expect(barSections(rows).map((section) => section.group)).toContain('archived');
    expect(barRows({ ...input, text: 'nothing like it' }).map((item) => item.group)).not.toContain(
      'archived',
    );
  });
});

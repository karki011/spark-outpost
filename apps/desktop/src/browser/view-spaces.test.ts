import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserProfile, BrowserViewState } from '@spark-outpost/contracts';
import { net, type FakeContents } from './electron.fixture.ts';
import { invoke, memorySaved, startTestBrowser } from './view-host.fixture.ts';
import { loadSavedView, parseSavedView, type SavedTab } from './view-saved.ts';

vi.mock('electron', async () => (await import('./electron-ipc.fixture.ts')).fakeElectronWithIpc);
vi.mock('./cdp.ts', () => ({
  attachCdp: (contents: FakeContents) => contents.cdp,
}));

const DOCS = 'https://docs.example.com/guide';
const NEWS = 'https://news.example.com/';
const MAIL = 'https://mail.example.com/inbox';

const OLD_FILE = JSON.stringify({
  version: 1,
  profiles: {
    personal: {
      tabs: [
        { url: DOCS, title: 'Guide', pinned: true, active: false },
        { url: NEWS, title: 'News', pinned: false, active: true },
      ],
      favorites: [{ id: 'abcd1234', url: MAIL, title: 'Mail' }],
    },
    work: { tabs: [], favorites: [] },
  },
  searchEngine: 'google',
});

const tabOf = (url: string, title = url, extra: Partial<SavedTab> = {}): SavedTab => ({
  url,
  title,
  pinned: false,
  active: false,
  ...extra,
});

async function state(profile: BrowserProfile): Promise<BrowserViewState> {
  return (await invoke('browser-view:state', profile)) as BrowserViewState;
}

const send = (profile: BrowserProfile, command: unknown) =>
  invoke('browser-view:command', profile, command);

async function newSpace(profile: BrowserProfile, name: string): Promise<string> {
  await send(profile, { command: 'space_create', name, icon: 'book', color: 'accent' });
  return (await state(profile)).layout.currentSpaceId;
}

beforeEach(() => net.reset());

describe('saved Spaces', () => {
  let folder: string;
  beforeEach(async () => {
    folder = await mkdtemp(path.join(tmpdir(), 'spark-view-'));
  });
  afterEach(() => rm(folder, { recursive: true, force: true }));

  it('loads a file from before Spaces with nothing lost, in one default Space', async () => {
    const saved = parseSavedView(OLD_FILE);
    expect(saved.searchEngine).toBe('google');
    expect(saved.archive).toEqual({ on: true, afterMinutes: 720 });
    expect(saved.profiles.personal.favorites).toHaveLength(1);
    expect(saved.profiles.personal.spaces.map((space) => space.name)).toEqual(['Main']);
    expect(saved.profiles.work.spaces).toHaveLength(1);

    await writeFile(path.join(folder, 'browser-view.json'), OLD_FILE);
    const store = await loadSavedView(folder, () => undefined);
    const browser = startTestBrowser(store);
    await invoke('browser-view:start', 'personal');
    const after = await state('personal');
    expect(after.tabs.map((tab) => [tab.url, tab.pinned, tab.active])).toEqual([
      [DOCS, true, false],
      [NEWS, false, true],
    ]);
    const main = after.layout.spaces[0]!.id;
    expect(after.layout.places.every((place) => place.spaceId === main)).toBe(true);
    expect(after.layout.places[0]!.pinnedUrl).toBe(DOCS);
    browser.view.dispose();
  });

  it('drops bad entries without losing the good ones', () => {
    const saved = parseSavedView(
      JSON.stringify({
        version: 1,
        profiles: {
          personal: {
            tabs: [
              { url: DOCS, title: 'Guide', pinned: false, active: false, spaceId: 7, shownAt: 'x' },
              { url: 5 },
              { url: 'file:///etc/hosts', title: 'hosts', pinned: false, active: false },
              {
                url: NEWS,
                title: 'N',
                pinned: true,
                active: false,
                pinnedUrl: 'file:///etc/hosts',
              },
            ],
            favorites: 'nope',
            spaces: [
              { id: 's1', name: '  ' },
              { id: 's2', name: 'Two', icon: 'bad', color: 'bad' },
            ],
            currentSpaceId: 'gone',
            folders: [
              { id: 'f1', spaceId: 'gone', name: 'Lost' },
              { id: 'f2', spaceId: 's2', name: 'Kept' },
            ],
            archived: [
              { id: 'a1', url: 'file:///etc/hosts', title: 'x', archivedAt: 1 },
              { id: 'a2', url: 'javascript:alert(1)', title: 'x', archivedAt: 1 },
              { id: 'a3', url: MAIL, title: 'Mail', archivedAt: 1 },
            ],
          },
          work: { tabs: [], favorites: [] },
        },
        archive: { on: true, afterMinutes: -4 },
      }),
    );
    const personal = saved.profiles.personal;
    expect(personal.tabs.map((tab) => tab.url)).toEqual([DOCS, NEWS]);
    expect(personal.tabs[1]!.pinnedUrl).toBeNull();
    expect(personal.spaces).toEqual([{ id: 's2', name: 'Two', icon: 'home', color: 'accent' }]);
    expect(personal.currentSpaceId).toBe('s2');
    expect(personal.folders.map((item) => item.id)).toEqual(['f2']);
    expect(personal.archived.map((item) => item.id)).toEqual(['a3']);
    expect(saved.archive.afterMinutes).toBe(720);
  });

  it('keeps Spaces, folders, pins and Archived across a relaunch, mode 0600', async () => {
    const file = path.join(folder, 'browser-view.json');
    await writeFile(file, OLD_FILE, { mode: 0o600 });
    const first = startTestBrowser(await loadSavedView(folder, () => undefined));
    await invoke('browser-view:start', 'personal');
    const reading = await newSpace('personal', 'Reading');
    await send('personal', { command: 'new_tab', url: MAIL });
    const mail = (await state('personal')).tabs.find((tab) => tab.url === MAIL)!;
    await send('personal', { command: 'pin', tabId: mail.id, pinned: true });
    await send('personal', { command: 'folder_create', name: 'Inbox', tabId: mail.id });
    await vi.waitFor(async () => {
      const text = await readFile(file, 'utf8');
      expect(text).toContain('Inbox');
      expect(text).toContain('"pinned":true');
    });
    first.view.dispose();

    const store = await loadSavedView(folder, () => undefined);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const second = startTestBrowser(store);
    await invoke('browser-view:start', 'personal');
    const after = await state('personal');
    expect(after.layout.currentSpaceId).toBe(reading);
    expect(after.layout.spaces.map((space) => space.name)).toEqual(['Main', 'Reading']);
    const restored = after.tabs.find((tab) => tab.url === MAIL)!;
    expect(restored.active).toBe(true);
    const place = after.layout.places.find((item) => item.tabId === restored.id)!;
    expect(place).toMatchObject({ spaceId: reading, pinnedUrl: MAIL });
    expect(after.layout.folders.find((item) => item.id === place.folderId)?.name).toBe('Inbox');
    expect(after.tabs).toHaveLength(3);
    second.view.dispose();
  });

  it('does not overwrite a profile not yet shown', async () => {
    const memory = memorySaved({ work: { tabs: [tabOf(DOCS)], favorites: [] } });
    startTestBrowser(memory.store);
    await invoke('browser-view:start', 'personal');
    await newSpace('personal', 'Two');
    expect(memory.profiles.work.tabs).toHaveLength(1);
    expect(memory.profiles.work.spaces).toHaveLength(1);
    expect(memory.profiles.personal.spaces).toHaveLength(2);
  });
});

describe('Spaces', () => {
  it('shows only a Space’s own tab and remembers it when switching back', async () => {
    startTestBrowser();
    await invoke('browser-view:start', 'work');
    const main = (await state('work')).layout.currentSpaceId;
    await send('work', { command: 'new_tab', url: DOCS });
    const two = await newSpace('work', 'Two');
    let now = await state('work');
    expect(now.tabs.some((tab) => tab.active)).toBe(false);
    await send('work', { command: 'new_tab', url: NEWS });
    now = await state('work');
    expect(now.tabs.find((tab) => tab.active)?.url).toBe(NEWS);
    await send('work', { command: 'space_switch', id: main });
    now = await state('work');
    expect(now.tabs.find((tab) => tab.active)?.url).toBe(DOCS);
    await send('work', { command: 'space_switch', id: two });
    now = await state('work');
    expect(now.tabs.find((tab) => tab.active)?.url).toBe(NEWS);
  });

  it('stays in the Space when its last tab closes, with nothing showing', async () => {
    const browser = startTestBrowser();
    await invoke('browser-view:start', 'work');
    await send('work', { command: 'new_tab', url: DOCS });
    const two = await newSpace('work', 'Two');
    await send('work', { command: 'new_tab', url: NEWS });
    const news = browser.view.panes.tabsOf('work').find((tab) => tab.currentUrl() === NEWS)!;
    await send('work', { command: 'close', tabId: news.id });
    const now = await state('work');
    expect(now.layout.currentSpaceId).toBe(two);
    expect(now.tabs.some((tab) => tab.active)).toBe(false);
  });

  it('follows a tab selected in another Space', async () => {
    startTestBrowser();
    await invoke('browser-view:start', 'work');
    const main = (await state('work')).layout.currentSpaceId;
    await send('work', { command: 'new_tab', url: DOCS });
    const docs = (await state('work')).tabs.find((tab) => tab.url === DOCS)!;
    await newSpace('work', 'Two');
    await send('work', { command: 'select', tabId: docs.id });
    const now = await state('work');
    expect(now.layout.currentSpaceId).toBe(main);
    expect(now.tabs.find((tab) => tab.active)?.id).toBe(docs.id);
  });

  it('moves tabs to a neighbour when a Space is deleted and keeps the last Space', async () => {
    startTestBrowser();
    await invoke('browser-view:start', 'work');
    const main = (await state('work')).layout.currentSpaceId;
    const two = await newSpace('work', 'Two');
    await send('work', { command: 'new_tab', url: NEWS });
    const news = (await state('work')).tabs.find((tab) => tab.url === NEWS)!;
    await send('work', { command: 'pin', tabId: news.id, pinned: true });
    await send('work', { command: 'folder_create', name: 'F', tabId: news.id });
    await send('work', { command: 'space_delete', id: two });
    let now = await state('work');
    expect(now.layout.currentSpaceId).toBe(main);
    expect(now.layout.folders).toEqual([]);
    expect(now.layout.places.find((place) => place.tabId === news.id)).toMatchObject({
      spaceId: main,
      folderId: null,
    });
    expect(now.tabs.find((tab) => tab.id === news.id)?.pinned).toBe(true);
    await send('work', { command: 'space_delete', id: main });
    now = await state('work');
    expect(now.layout.spaces).toHaveLength(1);
  });

  it('never crosses profiles', async () => {
    startTestBrowser();
    await invoke('browser-view:start', 'work');
    await invoke('browser-view:start', 'personal');
    const personalSpace = await newSpace('personal', 'Private');
    await send('work', { command: 'new_tab', url: NEWS });
    const news = (await state('work')).tabs.find((tab) => tab.url === NEWS)!;
    const before = (await state('work')).layout;
    await send('work', { command: 'tab_to_space', tabId: news.id, spaceId: personalSpace });
    await send('work', { command: 'space_switch', id: personalSpace });
    const after = (await state('work')).layout;
    expect(after.currentSpaceId).toBe(before.currentSpaceId);
    expect(after.places).toEqual(before.places);
    expect(after.spaces.map((space) => space.id)).not.toContain(personalSpace);
  });

  it.skipIf(process.platform !== 'darwin')(
    'runs ⌃1 to ⌃9 only for Browser view pages, never for a chat pane page',
    async () => {
      const browser = startTestBrowser();
      await invoke('browser-view:start', 'work');
      const main = (await state('work')).layout.currentSpaceId;
      await send('work', { command: 'new_tab', url: DOCS });
      await newSpace('work', 'Two');
      const docs = browser.view.panes.tabsOf('work')[0]!;
      await docs.wake();
      const contents = docs.contents() as unknown as FakeContents;
      const input = {
        type: 'keyDown',
        code: 'Digit1',
        control: true,
        meta: false,
        shift: false,
        alt: false,
        isComposing: false,
      };
      const preventDefault = vi.fn();
      contents.emit('before-input-event', { preventDefault }, input);
      await vi.waitFor(async () => expect((await state('work')).layout.currentSpaceId).toBe(main));
      expect(preventDefault).toHaveBeenCalled();

      const chat = browser.chats.createTab('11111111-2222-4333-8444-555555555555', {
        owner: 'user',
        runId: null,
        url: DOCS,
      })!;
      await chat.wake();
      const chatKey = vi.fn();
      (chat.contents() as unknown as FakeContents).emit(
        'before-input-event',
        { preventDefault: chatKey },
        input,
      );
      expect(chatKey).not.toHaveBeenCalled();
    },
  );
});

describe('tab folders', () => {
  it('groups only pinned tabs, collapses, renames, and a deleted folder keeps its tabs', async () => {
    startTestBrowser();
    await invoke('browser-view:start', 'work');
    await send('work', { command: 'new_tab', url: DOCS });
    const docs = (await state('work')).tabs.find((tab) => tab.url === DOCS)!;
    await send('work', { command: 'folder_create', name: 'Refs', tabId: docs.id });
    let now = await state('work');
    const folder = now.layout.folders[0]!;
    expect(now.layout.places.find((place) => place.tabId === docs.id)?.folderId).toBeNull();

    await send('work', { command: 'pin', tabId: docs.id, pinned: true });
    await send('work', { command: 'tab_to_folder', tabId: docs.id, folderId: folder.id });
    await send('work', { command: 'folder_collapse', id: folder.id, collapsed: true });
    await send('work', { command: 'folder_rename', id: folder.id, name: 'Docs' });
    now = await state('work');
    expect(now.layout.folders[0]).toMatchObject({ name: 'Docs', collapsed: true });
    expect(now.layout.places.find((place) => place.tabId === docs.id)?.folderId).toBe(folder.id);

    await send('work', { command: 'folder_delete', id: folder.id });
    now = await state('work');
    expect(now.layout.folders).toEqual([]);
    expect(now.tabs.find((tab) => tab.id === docs.id)?.pinned).toBe(true);

    await send('work', { command: 'folder_create', name: 'Again', tabId: docs.id });
    await send('work', { command: 'pin', tabId: docs.id, pinned: false });
    now = await state('work');
    expect(now.layout.places.find((place) => place.tabId === docs.id)).toMatchObject({
      folderId: null,
      pinnedUrl: null,
    });
  });
});

describe('Back to pinned address', () => {
  it('returns a wandered pinned tab to the address it was pinned at', async () => {
    const browser = startTestBrowser();
    await invoke('browser-view:start', 'work');
    await send('work', { command: 'new_tab', url: DOCS });
    const docs = (await state('work')).tabs.find((tab) => tab.url === DOCS)!;
    await send('work', { command: 'pin', tabId: docs.id, pinned: true });
    await send('work', { command: 'navigate', tabId: docs.id, url: NEWS });
    let now = await state('work');
    expect(now.layout.places.find((place) => place.tabId === docs.id)?.pinnedUrl).toBe(DOCS);
    expect(now.tabs.find((tab) => tab.id === docs.id)?.url).toBe(NEWS);
    await send('work', { command: 'pinned_home', tabId: docs.id });
    now = await state('work');
    expect(now.tabs.find((tab) => tab.id === docs.id)?.url).toBe(DOCS);
    expect(browser.view.panes.tabsOf('work')).toHaveLength(2);
  });
});

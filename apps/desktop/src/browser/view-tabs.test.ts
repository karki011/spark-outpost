import { beforeEach, describe, expect, it, vi } from 'vitest';
import { net, type FakeContents } from './electron.fixture.ts';
import { BROWSER_PARTITION, PERSONAL_PARTITION } from './request-guard.ts';
import { invoke, memorySaved, startTestBrowser } from './view-host.fixture.ts';
import { keptTabs, parseSavedView } from './view-saved.ts';
import { handToChat, toView } from './view-transfer.ts';

vi.mock('electron', async () => (await import('./electron-ipc.fixture.ts')).fakeElectronWithIpc);
vi.mock('./cdp.ts', () => ({
  attachCdp: (contents: FakeContents) => contents.cdp,
}));

const CHAT = '11111111-2222-4333-8444-555555555555';
const DOCS = 'https://docs.example.com/guide';
const NEWS = 'https://news.example.com/';

beforeEach(() => net.reset());

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function openIn(profile: 'personal' | 'work', url: string) {
  const browser = startTestBrowser();
  await invoke('browser-view:start', profile);
  const [tab] = browser.view.panes.tabsOf(profile);
  await invoke('browser-view:command', profile, { command: 'navigate', tabId: tab!.id, url });
  return { ...browser, tab: tab! };
}

describe('the saved Browser view', () => {
  it('reads only web addresses back from the file', () => {
    const saved = parseSavedView(
      JSON.stringify({
        version: 1,
        profiles: {
          personal: {
            tabs: [
              { url: DOCS, title: 'Guide', pinned: true, active: true },
              { url: 'file:///etc/hosts', title: 'hosts', pinned: false, active: false },
              { url: 'javascript:alert(1)', title: 'x', pinned: false, active: false },
            ],
            favorites: [{ id: 'f1', url: 'data:text/html,hi', title: 'x' }],
          },
          work: { tabs: [], favorites: [] },
        },
      }),
    );
    expect(saved.profiles.personal.tabs).toEqual([
      { url: DOCS, title: 'Guide', pinned: true, active: true },
    ]);
    expect(saved.profiles.personal.favorites).toEqual([]);
    expect(parseSavedView('not json').profiles.work.tabs).toEqual([]);
    expect(parseSavedView('{"version":2}').profiles.personal.tabs).toEqual([]);
  });

  it('keeps the search engine, with DuckDuckGo for a new or unknown one', async () => {
    expect(parseSavedView('{}').searchEngine).toBe('duckduckgo');
    const file = (engine: unknown) =>
      JSON.stringify({
        version: 1,
        profiles: { personal: { tabs: [], favorites: [] }, work: { tabs: [], favorites: [] } },
        searchEngine: engine,
      });
    expect(parseSavedView(file('google')).searchEngine).toBe('google');
    expect(parseSavedView(file('evil')).searchEngine).toBe('duckduckgo');
    expect(parseSavedView(file(undefined)).searchEngine).toBe('duckduckgo');

    startTestBrowser();
    expect(await invoke('browser-view:search-engine')).toBe('duckduckgo');
    expect(await invoke('browser-view:set-search-engine', 'bing')).toBe('bing');
    expect(await invoke('browser-view:search-engine')).toBe('bing');
    await expect(
      invoke('browser-view:set-search-engine', 'https://evil.example/?q='),
    ).rejects.toThrow();
    expect(await invoke('browser-view:search-engine')).toBe('bing');
  });

  it('keeps Open links in, with Spark for a new or unknown choice', async () => {
    expect(parseSavedView('{}').linksIn).toBe('spark');
    const file = (linksIn: unknown) =>
      JSON.stringify({
        version: 1,
        profiles: { personal: { tabs: [], favorites: [] }, work: { tabs: [], favorites: [] } },
        linksIn,
      });
    expect(parseSavedView(file('browser')).linksIn).toBe('browser');
    expect(parseSavedView(file('chrome')).linksIn).toBe('spark');

    startTestBrowser();
    expect(await invoke('browser-view:links-in')).toBe('spark');
    expect(await invoke('browser-view:set-links-in', 'browser')).toBe('browser');
    await expect(invoke('browser-view:set-links-in', 'safari')).rejects.toThrow();
    expect(await invoke('browser-view:links-in')).toBe('browser');
  });

  it('opens a clicked link in a new tab of the profile asked for, web addresses only', async () => {
    const { view } = startTestBrowser();
    expect(await invoke('browser-view:open-tab', 'work', NEWS)).toBe(true);
    expect(view.panes.tabsOf('work').map((tab) => tab.currentUrl())).toEqual([NEWS]);
    expect(view.panes.tabsOf('personal')).toEqual([]);
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://a:b@example.com/']) {
      await expect(invoke('browser-view:open-tab', 'work', url)).rejects.toThrow();
    }
    await expect(invoke('browser-view:open-tab', CHAT, NEWS)).rejects.toThrow();
    expect(view.panes.tabsOf('work')).toHaveLength(1);
  });

  it('keeps no blank tab', () => {
    const blank = { url: 'about:blank', title: '', pinned: false, active: true };
    expect(keptTabs([blank, { ...blank, url: NEWS }])).toEqual([{ ...blank, url: NEWS }]);
  });

  it('brings tabs back after a relaunch, asleep until shown, on their own profile', async () => {
    const { store, profiles } = memorySaved({
      personal: {
        tabs: [
          { url: DOCS, title: 'Guide', pinned: true, active: false },
          { url: NEWS, title: 'News', pinned: false, active: true },
        ],
        favorites: [],
        zooms: {},
      },
    });
    const { view } = startTestBrowser(store);
    await invoke('browser-view:start', 'personal');
    const tabs = view.panes.tabsOf('personal');
    expect(
      tabs.map((tab) => [tab.currentUrl(), tab.currentTitle(), tab.pinned, tab.active]),
    ).toEqual([
      [DOCS, 'Guide', true, false],
      [NEWS, 'News', false, true],
    ]);
    expect(tabs.every((tab) => tab.view() === null)).toBe(true);
    await settle();
    expect(profiles.personal.tabs).toHaveLength(2);
    expect(profiles.work.tabs).toEqual([]);
  });

  it('saves what the user opens, and leaves a profile not yet shown alone', async () => {
    const work = { url: NEWS, title: 'News', pinned: false, active: true };
    const { store, profiles } = memorySaved({ work: { tabs: [work], favorites: [], zooms: {} } });
    const { view } = startTestBrowser(store);
    await invoke('browser-view:start', 'personal');
    const [tab] = view.panes.tabsOf('personal');
    await invoke('browser-view:command', 'personal', {
      command: 'navigate',
      tabId: tab!.id,
      url: DOCS,
    });
    await invoke('browser-view:command', 'personal', {
      command: 'pin',
      tabId: tab!.id,
      pinned: true,
    });
    await settle();
    expect(profiles.personal.tabs).toMatchObject([
      { url: DOCS, title: '', pinned: true, active: true, pinnedUrl: DOCS },
    ]);
    expect(profiles.work.tabs).toEqual([work]);
  });
});

describe('favorites', () => {
  it('adds the page once, opens or switches to it, and removes it', async () => {
    const { view, tab } = await openIn('personal', DOCS);
    await invoke('browser-view:command', 'personal', { command: 'add_favorite', tabId: tab.id });
    await invoke('browser-view:command', 'personal', { command: 'add_favorite', tabId: tab.id });
    const state = (await invoke('browser-view:state', 'personal')) as {
      favorites: { id: string; url: string }[];
    };
    expect(state.favorites.map((item) => item.url)).toEqual([DOCS]);
    const id = state.favorites[0]!.id;

    await invoke('browser-view:command', 'personal', { command: 'new_tab', url: NEWS });
    expect(
      view.panes
        .tabsOf('personal')
        .find((item) => item.active)
        ?.currentUrl(),
    ).toBe(NEWS);
    await invoke('browser-view:command', 'personal', { command: 'open_favorite', id });
    expect(view.panes.tabsOf('personal')).toHaveLength(2);
    expect(view.panes.tabsOf('personal').find((item) => item.active)?.id).toBe(tab.id);

    await invoke('browser-view:command', 'personal', { command: 'close', tabId: tab.id });
    await invoke('browser-view:command', 'personal', { command: 'open_favorite', id });
    expect(view.panes.tabsOf('personal').map((item) => item.currentUrl())).toEqual([NEWS, DOCS]);

    await invoke('browser-view:command', 'personal', { command: 'remove_favorite', id });
    expect(
      ((await invoke('browser-view:state', 'personal')) as { favorites: unknown[] }).favorites,
    ).toEqual([]);
  });

  it('opens the saved page rather than another page on the same site', async () => {
    const { view, tab } = await openIn('personal', DOCS);
    await invoke('browser-view:command', 'personal', { command: 'add_favorite', tabId: tab.id });
    const [favorite] = (
      (await invoke('browser-view:state', 'personal')) as {
        favorites: { id: string }[];
      }
    ).favorites;
    const other = 'https://docs.example.com/api';
    await invoke('browser-view:command', 'personal', {
      command: 'navigate',
      tabId: tab.id,
      url: other,
    });
    await invoke('browser-view:command', 'personal', {
      command: 'open_favorite',
      id: favorite!.id,
    });
    expect(view.panes.tabsOf('personal').map((item) => item.currentUrl())).toEqual([other, DOCS]);
    await invoke('browser-view:command', 'personal', {
      command: 'navigate',
      tabId: tab.id,
      url: `${DOCS}#install`,
    });
    await invoke('browser-view:command', 'personal', {
      command: 'open_favorite',
      id: favorite!.id,
    });
    expect(view.panes.tabsOf('personal')).toHaveLength(2);
  });
});

describe('handing tabs between the Browser view and a chat', () => {
  it('moves a Work tab into the chat as the user’s tab', async () => {
    const { chats, view, tab } = await openIn('work', DOCS);
    const result = await handToChat(chats, view, { profile: 'work', tabId: tab.id, chatId: CHAT });
    expect(result).toEqual({ ok: true });
    const [moved] = chats.tabsOf(CHAT);
    expect(moved!.owner).toBe('user');
    expect(moved!.currentUrl()).toBe(DOCS);
    expect(view.panes.tabsOf('work')).toEqual([]);
    const contents = moved!.view()!.webContents as unknown as FakeContents;
    expect(contents.session.partition).toBe(BROWSER_PARTITION);
  });

  it('gives a chat only a Personal tab’s address, in a new Work tab', async () => {
    const { chats, view, tab } = await openIn('personal', DOCS);
    (tab.view()!.webContents as unknown as FakeContents).session.cookies.set(
      'docs.example.com',
      'personal-session',
    );
    await handToChat(chats, view, { profile: 'personal', tabId: tab.id, chatId: CHAT });
    expect(view.panes.tabsOf('personal')).toEqual([tab]);
    const [opened] = chats.tabsOf(CHAT);
    const contents = opened!.view()!.webContents as unknown as FakeContents;
    expect(contents.session.partition).toBe(BROWSER_PARTITION);
    expect(contents.session.partition).not.toBe(PERSONAL_PARTITION);
    expect(net.requests.at(-1)).toEqual({ partition: BROWSER_PARTITION, url: DOCS, cookie: null });
  });

  it('keeps a Work tab that is in use, and moves it only once the chat has it', async () => {
    const { chats, view, tab } = await openIn('work', DOCS);
    tab.picking = true;
    expect(await handToChat(chats, view, { profile: 'work', tabId: tab.id, chatId: CHAT })).toEqual(
      { ok: false, reason: 'This tab is in use. Try again when it is free.' },
    );
    expect(chats.tabsOf(CHAT)).toEqual([]);
    tab.picking = false;
    const close = vi.spyOn(view.panes, 'close');
    const load = vi
      .spyOn(Object.getPrototypeOf(tab), 'load')
      .mockRejectedValueOnce(new Error('gone'));
    expect(
      await handToChat(chats, view, { profile: 'work', tabId: tab.id, chatId: CHAT }),
    ).toMatchObject({
      ok: false,
    });
    expect(close).not.toHaveBeenCalledWith('work', tab.id);
    expect(view.panes.tabsOf('work')).toEqual([tab]);
    expect(chats.tabsOf(CHAT)).toEqual([]);
    load.mockRestore();
  });

  it('refuses a blank tab', async () => {
    const browser = startTestBrowser();
    await invoke('browser-view:start', 'personal');
    const [tab] = browser.view.panes.tabsOf('personal');
    expect(
      await handToChat(browser.chats, browser.view, {
        profile: 'personal',
        tabId: tab!.id,
        chatId: CHAT,
      }),
    ).toEqual({ ok: false, reason: 'Open a page first.' });
  });

  it('opens a chat tab in the Browser view’s Work profile and takes it from the chat', async () => {
    const { chats, view } = startTestBrowser();
    const tab = chats.createTab(CHAT, { owner: 'agent', runId: null, url: 'about:blank' })!;
    await tab.load(NEWS);
    expect(await toView(chats, view, { chatId: CHAT, tabId: tab.id })).toEqual({ ok: true });
    expect(chats.tabsOf(CHAT)).toEqual([]);
    expect(view.panes.tabsOf('work').map((item) => item.currentUrl())).toContain(NEWS);
    expect(view.panes.tabsOf('personal')).toEqual([]);
  });

  it('keeps a chat tab the agent is using, or one showing a project file', async () => {
    const { chats, view } = startTestBrowser();
    const busy = chats.createTab(CHAT, { owner: 'agent', runId: null, url: 'about:blank' })!;
    await busy.load(NEWS);
    busy.agentBusy = 1;
    expect(await toView(chats, view, { chatId: CHAT, tabId: busy.id })).toMatchObject({
      ok: false,
    });
    const file = chats.createTab(
      CHAT,
      { owner: 'user', runId: null, url: 'about:blank' },
      { projectId: null, roots: ['/Users/me/app'] },
    )!;
    await file.load('file:///Users/me/app/index.html');
    expect(await toView(chats, view, { chatId: CHAT, tabId: file.id })).toEqual({
      ok: false,
      reason: 'Only web pages open in the Browser view.',
    });
    expect(chats.tabsOf(CHAT)).toHaveLength(2);
  });

  it('keeps the chat tab when the Work profile, saved tabs included, is full', async () => {
    const full = memorySaved();
    full.store.setTabs(
      'work',
      Array.from({ length: 40 }, (_, index) => ({
        url: `https://site${index}.example.com/`,
        title: `Site ${index}`,
        pinned: false,
        active: index === 0,
      })),
    );
    const { chats, view } = startTestBrowser(full.store);
    const tab = chats.createTab(CHAT, { owner: 'user', runId: null, url: 'about:blank' })!;
    await tab.load(NEWS);
    expect(await toView(chats, view, { chatId: CHAT, tabId: tab.id })).toEqual({
      ok: false,
      reason: 'The Browser view has too many Work tabs. Close one first.',
    });
    expect(chats.tabsOf(CHAT)).toEqual([tab]);
  });
});

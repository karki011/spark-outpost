import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserProfile, BrowserViewState } from '@spark-outpost/contracts';
import { net, type FakeContents } from './electron.fixture.ts';
import { invoke, memorySaved, startTestBrowser } from './view-host.fixture.ts';
import { tabsToArchive, type ArchiveFacts } from './view-archive.ts';
import type { SavedTab } from './view-saved.ts';

vi.mock('electron', async () => (await import('./electron-ipc.fixture.ts')).fakeElectronWithIpc);
vi.mock('./cdp.ts', () => ({
  attachCdp: (contents: FakeContents) => contents.cdp,
}));

const DOCS = 'https://docs.example.com/guide';
const NEWS = 'https://news.example.com/';
const MAIL = 'https://mail.example.com/inbox';
const HOUR = 60 * 60_000;

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

function testClock(start = 1_000 * HOUR) {
  const clock = {
    time: start,
    tick: () => undefined as void,
    now: () => clock.time,
    sweepEvery: (run: () => void) => {
      clock.tick = run;
      return () => undefined;
    },
  };
  return clock;
}

beforeEach(() => net.reset());

describe('auto-archive', () => {
  const facts = (over: Partial<ArchiveFacts>): ArchiveFacts => ({
    id: 'a',
    url: NEWS,
    pinned: false,
    spaceId: 's',
    shownAt: 0,
    audible: false,
    busy: false,
    showing: false,
    ...over,
  });
  const showing = facts({ id: 'front', url: DOCS, shownAt: 13 * HOUR, showing: true });

  it('picks only Today tabs past the time, keeping what must stay', () => {
    const at = (tab: Partial<ArchiveFacts>) =>
      tabsToArchive(
        [showing, facts(tab)],
        [{ id: 'f', url: MAIL, title: 'Mail' }],
        12 * HOUR,
        13 * HOUR,
      );
    expect(at({})).toEqual(['a']);
    expect(at({ shownAt: 2 * HOUR })).toEqual([]);
    expect(at({ pinned: true })).toEqual([]);
    expect(at({ audible: true })).toEqual([]);
    expect(at({ busy: true })).toEqual([]);
    expect(at({ url: `${MAIL}?x=1#top` })).toEqual([]);
  });

  it('keeps each Space’s front tab', () => {
    const older = facts({ id: 'old', spaceId: 'other', shownAt: 0 });
    const newer = facts({ id: 'new', spaceId: 'other', shownAt: HOUR });
    expect(tabsToArchive([showing, older, newer], [], 12 * HOUR, 20 * HOUR)).toEqual(['old']);
  });

  it('never archives a side of a split, on the timer or at launch', async () => {
    const clock = testClock();
    const memory = memorySaved();
    const browser = startTestBrowser(memory.store, clock);
    await invoke('browser-view:start', 'work');
    await send('work', { command: 'new_tab', url: NEWS });
    await send('work', { command: 'new_tab', url: DOCS });
    const tabs = browser.view.panes.tabsOf('work');
    const news = tabs.find((tab) => tab.currentUrl() === NEWS)!;
    await send('work', { command: 'split_with', tabId: news.id });
    clock.time += 13 * HOUR;
    clock.tick();
    expect(browser.view.panes.tab('work', news.id)).toBeTruthy();

    const restored = memorySaved({
      work: {
        favorites: [],
        tabs: [
          { url: DOCS, title: 'Docs', pinned: false, active: true },
          {
            url: NEWS,
            title: 'News',
            pinned: false,
            active: false,
            shownAt: 0,
            split: { side: 'right', ratio: 0.5 },
          },
        ],
      },
    });
    const later = startTestBrowser(restored.store, testClock());
    await invoke('browser-view:start', 'work');
    expect(later.view.panes.tabsOf('work').map((tab) => tab.currentUrl())).toContain(NEWS);
  });

  it('moves a tab to Archived on the timer, reopens it, and keeps the list per profile', async () => {
    const clock = testClock();
    const memory = memorySaved();
    const browser = startTestBrowser(memory.store, clock);
    await invoke('browser-view:start', 'work');
    await invoke('browser-view:start', 'personal');
    await send('work', { command: 'new_tab', url: NEWS });
    await send('work', { command: 'new_tab', url: DOCS });
    const before = browser.view.panes.tabsOf('work').length;

    clock.time += 11 * HOUR;
    clock.tick();
    expect(browser.view.panes.tabsOf('work')).toHaveLength(before);

    clock.time += 2 * HOUR;
    clock.tick();
    const now = await state('work');
    expect(now.tabs.map((tab) => tab.url)).toEqual([DOCS]);
    expect(now.layout.archived.map((tab) => tab.url)).toEqual([NEWS]);
    expect(now.layout.archived[0]!.archivedAt).toBe(clock.time);
    expect(memory.profiles.work.archived.map((tab) => tab.url)).toEqual([NEWS]);
    expect((await state('personal')).layout.archived).toEqual([]);

    await send('work', { command: 'archived_open', id: now.layout.archived[0]!.id });
    const reopened = await state('work');
    expect(reopened.layout.archived).toEqual([]);
    expect(reopened.tabs.find((tab) => tab.active)?.url).toBe(NEWS);
  });

  it('never archives a tab playing sound, and does nothing when off', async () => {
    const clock = testClock();
    const memory = memorySaved();
    const browser = startTestBrowser(memory.store, clock);
    await invoke('browser-view:start', 'work');
    await send('work', { command: 'new_tab', url: NEWS });
    const news = browser.view.panes.tabsOf('work').find((tab) => tab.currentUrl() === NEWS)!;
    await send('work', { command: 'new_tab', url: DOCS });
    (news.contents() as unknown as FakeContents).audible = true;
    clock.time += 24 * HOUR;
    clock.tick();
    expect(browser.view.panes.tabsOf('work')).toContain(news);

    (news.contents() as unknown as FakeContents).audible = false;
    await invoke('browser-view:set-archive', { on: false, afterMinutes: 720 });
    clock.tick();
    expect(browser.view.panes.tabsOf('work')).toContain(news);

    await invoke('browser-view:set-archive', { on: true, afterMinutes: 720 });
    clock.tick();
    expect(browser.view.panes.tabsOf('work')).not.toContain(news);
  });

  it('archives overdue tabs on a relaunch without opening them', async () => {
    const clock = testClock();
    const memory = memorySaved({
      work: {
        tabs: [
          tabOf(DOCS, 'Showing', { active: true, shownAt: 0 }),
          tabOf(NEWS, 'Stale', { shownAt: 0 }),
          tabOf(MAIL, 'Pinned', { pinned: true, shownAt: 0 }),
          tabOf('https://fresh.example.com/', 'Old file', {}),
        ],
        favorites: [],
      },
    });
    const browser = startTestBrowser(memory.store, clock);
    await invoke('browser-view:start', 'work');
    const now = await state('work');
    expect(now.tabs.map((tab) => tab.title)).toEqual(['Showing', 'Pinned', 'Old file']);
    expect(now.layout.archived.map((tab) => tab.title)).toEqual(['Stale']);
    expect(browser.view.panes.tabsOf('work').every((tab) => !tab.view())).toBe(true);
  });

  it('can be cleared and rejects a bad setting', async () => {
    const clock = testClock();
    const browser = startTestBrowser(
      memorySaved({
        work: {
          tabs: [],
          favorites: [],
          archived: [
            { id: 'a1', url: NEWS, title: 'N', archivedAt: 1 },
            { id: 'a2', url: DOCS, title: 'D', archivedAt: 1 },
          ],
        },
      }).store,
      clock,
    );
    await invoke('browser-view:start', 'work');
    await send('work', { command: 'archived_remove', id: 'a1' });
    expect((await state('work')).layout.archived.map((tab) => tab.id)).toEqual(['a2']);
    await send('work', { command: 'archived_clear' });
    expect((await state('work')).layout.archived).toEqual([]);
    await expect(
      invoke('browser-view:set-archive', { on: true, afterMinutes: 0 }),
    ).rejects.toThrow();
    browser.view.dispose();
  });
});

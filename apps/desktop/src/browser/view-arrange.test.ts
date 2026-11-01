import { beforeEach, describe, expect, it, vi } from 'vitest';
import { net, type FakeContents, type FakeView } from './electron.fixture.ts';
import type { PaneTab } from './tab.ts';
import type { BrowserViewHost } from './view-host.ts';
import { invoke, memorySaved, startTestBrowser } from './view-host.fixture.ts';
import { parseSavedView } from './view-saved.ts';

vi.mock('electron', async () => (await import('./electron-ipc.fixture.ts')).fakeElectronWithIpc);
vi.mock('./cdp.ts', () => ({
  attachCdp: (contents: FakeContents) => contents.cdp,
}));

const DOCS = 'https://docs.example.com/guide';
const NEWS = 'https://news.example.com/';
const LINK = 'https://link.example.com/page';
const LEFT = { x: 10, y: 10, width: 400, height: 500 };
const RIGHT = { x: 420, y: 10, width: 400, height: 500 };

const settle = () => new Promise((resolve) => setImmediate(resolve));

let view: BrowserViewHost;
let saved: ReturnType<typeof memorySaved>;

beforeEach(() => {
  net.reset();
  saved = memorySaved();
  ({ view } = startTestBrowser(saved.store));
});

const command = (action: unknown, profile = 'work') =>
  invoke('browser-view:command', profile, action);
const stateOf = async (profile = 'work') => {
  await settle();
  return (await invoke('browser-view:state', profile)) as {
    tabs: { id: string; active: boolean; url: string }[];
    split: { leftTabId: string; rightTabId: string; ratio: number } | null;
    peek: { id: string; url: string } | null;
  };
};
const contentsOf = (tab: PaneTab) => tab.contents() as unknown as FakeContents;
const viewOf = (tab: PaneTab) => tab.view() as unknown as FakeView;

function key(tab: PaneTab, type: string, name: string, alt: boolean): void {
  contentsOf(tab).emit(
    'before-input-event',
    { preventDefault: () => undefined },
    {
      type,
      key: name,
      code: name,
      alt,
      isComposing: false,
    },
  );
}

function click(tab: PaneTab, modifiers: string[], url: string): void {
  const option = modifiers.includes('alt');
  if (option) key(tab, 'rawKeyDown', 'Alt', true);
  contentsOf(tab).emit('before-mouse-event', {}, { type: 'mouseDown' });
  contentsOf(tab).emit('before-mouse-event', {}, { type: 'mouseUp' });
  contentsOf(tab).windowOpen(url, 'new-window');
  if (option) key(tab, 'keyUp', 'Alt', false);
}

async function twoTabs() {
  await invoke('browser-view:start', 'work');
  const [first] = view.panes.tabsOf('work');
  await command({ command: 'navigate', tabId: first!.id, url: DOCS });
  await command({ command: 'new_tab', url: NEWS });
  await settle();
  const second = view.panes.tabsOf('work')[1]!;
  await command({ command: 'select', tabId: first!.id });
  await settle();
  return { first: first!, second };
}

async function place(tab: PaneTab, bounds: typeof LEFT | null, covered = false) {
  await invoke('browser-view:place-slot', { profile: 'work', tabId: tab.id, bounds, covered });
}

describe('split view', () => {
  it('shows both tabs at their own bounds and marks both on screen', async () => {
    const { first, second } = await twoTabs();
    await invoke('browser-view:place', { profile: 'work', bounds: LEFT, covered: false });
    await command({ command: 'split_with', tabId: second.id });
    expect((await stateOf()).split).toMatchObject({
      leftTabId: first.id,
      rightTabId: second.id,
    });
    await place(first, LEFT);
    await place(second, RIGHT);
    expect(viewOf(first).bounds).toEqual(LEFT);
    expect(viewOf(second).bounds).toEqual(RIGHT);
    expect([viewOf(first).visible, viewOf(second).visible]).toEqual([true, true]);
    expect([first.shown, second.shown]).toEqual([true, true]);
    expect(first.inputMarks().shown && second.inputMarks().shown).toBe(true);
  });

  it('hides a covered side and asks for its snapshot by tab', async () => {
    const { first, second } = await twoTabs();
    await invoke('browser-view:place', { profile: 'work', bounds: LEFT, covered: false });
    await command({ command: 'split_with', tabId: second.id });
    await settle();
    await place(first, LEFT);
    await place(second, RIGHT);
    await place(second, RIGHT, true);
    expect(viewOf(second).visible).toBe(false);
    expect(second.shown).toBe(false);
    expect(viewOf(first).visible).toBe(true);
  });

  it('refuses a tab of the other profile', async () => {
    const { second } = await twoTabs();
    await invoke('browser-view:start', 'personal');
    await command({ command: 'split_with', tabId: second.id }, 'personal');
    expect((await stateOf('personal')).split).toBeNull();
    const before = view.panes.tabsOf('personal').length;
    expect(before).toBe(1);
  });

  it('ignores a placement for a tab that is not in the split', async () => {
    const { first, second } = await twoTabs();
    await place(second, RIGHT);
    expect(first.shown).toBe(false);
    expect(viewOf(second).visible).toBe(false);
  });

  it('leaves when a side closes and shows the other side', async () => {
    const { first, second } = await twoTabs();
    await command({ command: 'new_tab', url: LINK });
    await settle();
    const third = view.panes.tabsOf('work')[2]!;
    await command({ command: 'select', tabId: first.id });
    await command({ command: 'split_with', tabId: second.id });
    await settle();
    await command({ command: 'close', tabId: first.id });
    const state = await stateOf();
    expect(state.split).toBeNull();
    await settle();
    expect(state.tabs.find((tab) => tab.id === second.id)?.active).toBe(true);
    expect(third.active).toBe(false);
  });

  it('stays when another tab is selected and shows again on return', async () => {
    const { first, second } = await twoTabs();
    await command({ command: 'new_tab', url: LINK });
    await settle();
    const third = view.panes.tabsOf('work')[2]!;
    await command({ command: 'select', tabId: first.id });
    await invoke('browser-view:place', { profile: 'work', bounds: LEFT, covered: false });
    await command({ command: 'split_with', tabId: second.id });
    await settle();
    await place(first, LEFT);
    await place(second, RIGHT);
    await command({ command: 'select', tabId: third.id });
    await settle();
    expect((await stateOf()).split).not.toBeNull();
    expect(viewOf(first).visible).toBe(false);
    expect(viewOf(second).visible).toBe(false);
    await command({ command: 'select', tabId: second.id });
    await settle();
    expect(viewOf(first).visible).toBe(true);
    expect(viewOf(second).visible).toBe(true);
  });

  it('makes a side active when the user presses in it', async () => {
    const { first, second } = await twoTabs();
    await command({ command: 'split_with', tabId: second.id });
    await settle();
    contentsOf(second).emit('before-mouse-event', {}, { type: 'mouseDown' });
    expect(second.active).toBe(true);
    expect(first.active).toBe(false);
  });

  it('opens a Shift+Option link on the right of the tab it came from', async () => {
    const { first } = await twoTabs();
    click(first, ['shift', 'alt'], LINK);
    const state = await stateOf();
    expect(state.split?.leftTabId).toBe(first.id);
    const right = view.panes.tab('work', state.split!.rightTabId)!;
    expect(right.peek).toBe(false);
    expect(right.active).toBe(true);
    expect(right.currentUrl()).toBe(LINK);
  });

  it('keeps the split beside its tabs across a relaunch', async () => {
    const { first, second } = await twoTabs();
    await command({ command: 'split_with', tabId: second.id });
    await command({ command: 'split_ratio', ratio: 0.35 });
    await settle();
    await settle();
    const tabs = saved.profiles.work.tabs;
    expect(tabs.map((tab) => tab.split)).toEqual([
      { side: 'left', ratio: 0.35 },
      { side: 'right', ratio: 0.35 },
    ]);
    expect(first.id).not.toBe(second.id);

    ({ view } = startTestBrowser(saved.store));
    await invoke('browser-view:start', 'work');
    const restored = await stateOf();
    const [left, right] = view.panes.tabsOf('work');
    expect(restored.split).toEqual({ leftTabId: left!.id, rightTabId: right!.id, ratio: 0.35 });
    expect(left!.view()).toBeNull();
    await place(right!, RIGHT);
    expect(right!.view()).not.toBeNull();
  });

  it('reads a file with no split, and drops a bad split without losing the tab', () => {
    const tab = { url: DOCS, title: 'Guide', pinned: false, active: true };
    const file = (split: unknown) =>
      JSON.stringify({
        version: 1,
        profiles: {
          personal: { tabs: [], favorites: [] },
          work: { tabs: [{ ...tab, split }], favorites: [] },
        },
      });
    expect(parseSavedView(file(undefined)).profiles.work.tabs).toEqual([tab]);
    expect(parseSavedView(file({ side: 'up', ratio: 9 })).profiles.work.tabs).toEqual([tab]);
    expect(parseSavedView(file({ side: 'left', ratio: 0.3 })).profiles.work.tabs[0]?.split).toEqual(
      { side: 'left', ratio: 0.3 },
    );
  });
});

describe('Peek', () => {
  async function peeked() {
    const { first, second } = await twoTabs();
    click(first, ['shift'], LINK);
    await settle();
    const peek = view.panes.tabsOf('work').find((tab) => tab.peek)!;
    return { first, second, peek };
  }

  it('opens a Shift-click on the same partition, off the tab list and the saved file', async () => {
    const { first, peek } = await peeked();
    const state = await stateOf();
    expect(state.peek?.id).toBe(peek.id);
    expect(state.tabs.map((tab) => tab.id)).not.toContain(peek.id);
    expect(saved.profiles.work.tabs).toHaveLength(2);
    expect(peek.currentUrl()).toBe(LINK);
    expect(contentsOf(peek).session).toBe(contentsOf(first).session);
    expect(first.active).toBe(true);
  });

  it('holds the same guards: refuses Spark ports and is found by the guards', async () => {
    const { peek } = await peeked();
    expect(view.panes.tabOfContents(peek.contents())).toBe(peek);
    await command({ command: 'navigate', tabId: peek.id, url: 'http://localhost:32682/' });
    await settle();
    expect(peek.error).not.toBeNull();
    expect(contentsOf(peek).url).toBe(LINK);
  });

  it('marks itself on screen when placed, so the user can download and copy there', async () => {
    const { peek } = await peeked();
    await place(peek, LEFT);
    expect(viewOf(peek).visible).toBe(true);
    expect(peek.inputMarks().shown).toBe(true);
    expect(peek.active).toBe(false);
  });

  it('leaves a popup a page opened as an ordinary tab', async () => {
    const { first } = await twoTabs();
    contentsOf(first).emit('before-mouse-event', {}, { type: 'mouseUp' });
    contentsOf(first).windowOpen(LINK, 'new-window', 'width=500');
    const state = await stateOf();
    expect(state.peek).toBeNull();
    expect(state.tabs).toHaveLength(3);
  });

  it('closes on Esc from its page or the page under it, and the page does not get the key', async () => {
    const { first, peek } = await peeked();
    const event = { preventDefault: vi.fn() };
    contentsOf(peek).emit('before-input-event', event, {
      type: 'keyDown',
      key: 'Escape',
      isComposing: false,
    });
    expect(event.preventDefault).toHaveBeenCalled();
    expect((await stateOf()).peek).toBeNull();
    expect(view.panes.tabsOf('work')).toHaveLength(2);
    expect(first.active).toBe(true);
    const later = { preventDefault: vi.fn() };
    contentsOf(first).emit('before-input-event', later, {
      type: 'keyDown',
      key: 'Escape',
      isComposing: false,
    });
    expect(later.preventDefault).not.toHaveBeenCalled();
  });

  it('becomes a real tab on Open as tab, with the same page and no reload', async () => {
    const { peek } = await peeked();
    const requests = net.requests.length;
    const contents = peek.contents();
    await command({ command: 'peek_promote' });
    const state = await stateOf();
    expect(state.peek).toBeNull();
    expect(state.tabs.find((tab) => tab.id === peek.id)?.active).toBe(true);
    expect(peek.contents()).toBe(contents);
    expect(net.requests).toHaveLength(requests);
    await settle();
    expect(saved.profiles.work.tabs.map((tab) => tab.url)).toContain(LINK);
  });

  it('closes with Close, and never becomes active when the showing tab closes', async () => {
    const { first, second, peek } = await peeked();
    await command({ command: 'close', tabId: first.id });
    await settle();
    await settle();
    expect(peek.active).toBe(false);
    expect(second.active).toBe(true);
    expect((await stateOf()).peek).toBeNull();
    expect(view.panes.tabsOf('work').some((tab) => tab.peek)).toBe(false);
  });

  it('closes when another tab is chosen, and ignores a select of its own id', async () => {
    const { second, peek } = await peeked();
    await command({ command: 'select', tabId: peek.id });
    expect(peek.active).toBe(false);
    await command({ command: 'select', tabId: second.id });
    expect((await stateOf()).peek).toBeNull();
  });

  it('reuses its own panel for a Shift-click inside it', async () => {
    const { peek } = await peeked();
    click(peek, ['shift'], NEWS);
    await settle();
    expect(view.panes.tabsOf('work').filter((tab) => tab.peek)).toEqual([peek]);
    expect(peek.currentUrl()).toBe(NEWS);
  });
});

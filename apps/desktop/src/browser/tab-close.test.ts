import type { BrowserClosedTab, BrowserPaneState } from '@spark-outpost/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runBrowserOp } from './agent-ops.ts';
import { net, type FakeContents, type FakeView } from './electron.fixture.ts';
import { BrowserPanes } from './panes.ts';
import { TAB_CLOSED } from './tab.ts';

vi.mock('electron', async () => (await import('./electron.fixture.ts')).fakeElectron);
vi.mock('./cdp.ts', () => ({
  attachCdp: (contents: FakeContents) => contents.cdp,
}));

const CHAT = '11111111-2222-4333-8444-555555555555';
const RUN = '99999999-2222-4333-8444-555555555555';
const home = { projectId: null, roots: [] };
const signal = new AbortController().signal;
const handoff = {
  agent: 'Claude',
  site: 'https://idp.example.com',
  approvalId: '33333333-2222-4333-8444-555555555555',
};

class FakeWindow {
  readonly children = new Set<FakeView>();
  readonly contentView = {
    addChildView: (view: FakeView) => this.children.add(view),
    removeChildView: (view: FakeView) => this.children.delete(view),
  };
  readonly webContents = {
    isDestroyed: () => false,
    getZoomFactor: () => 1,
    focus: () => undefined,
  };

  isDestroyed(): boolean {
    return false;
  }
}

let panes: BrowserPanes;
let window: FakeWindow;
let pushed: BrowserPaneState[];

beforeEach(() => {
  net.reset();
  window = new FakeWindow();
  pushed = [];
  panes = new BrowserPanes({
    window: () => window as never,
    blockedPorts: () => new Set(),
    stateChanged: (state) => pushed.push(state),
    snapshot: () => undefined,
    localOriginSeen: () => undefined,
    contextMenu: () => undefined,
    addShortcut: () => undefined,
    paneShortcut: () => undefined,
    found: () => undefined,
    log: () => undefined,
  });
});

async function userOpens(url: string): Promise<string> {
  const tab = panes.createTab(CHAT, { owner: 'user', runId: null, url: 'about:blank' }, home)!;
  await tab.load(url);
  return tab.id;
}

async function agentOpens(url: string): Promise<string> {
  const opened = (await runBrowserOp(
    panes,
    { op: 'open', chatId: CHAT, runId: RUN, url, tab: undefined, ...home },
    signal,
  )) as { tabId: string };
  return opened.tabId;
}

function contentsOf(tabId: string): FakeContents {
  return panes.tab(CHAT, tabId)!.view()!.webContents as unknown as FakeContents;
}

function userCloses(tabId: string): BrowserClosedTab {
  let closed: BrowserClosedTab = { handoff: null };
  panes.keepFocus(CHAT, () => {
    closed = panes.closeByUser(CHAT, tabId);
  });
  return closed;
}

function expectClosed(tabId: string, contents: FakeContents): void {
  expect(panes.tab(CHAT, tabId)).toBeNull();
  expect(contents.isDestroyed()).toBe(true);
  expect([...window.children].map((view) => view.webContents)).not.toContain(contents);
}

describe('the user closing a Browser pane tab', () => {
  it('closes a normal tab and takes its view off the window', async () => {
    const tabId = await userOpens('https://docs.example.com/a');
    const contents = contentsOf(tabId);
    contents.focused = true;
    expect(userCloses(tabId)).toEqual({ handoff: null });
    expectClosed(tabId, contents);
  });

  it('closes an agent tab Spark kept open after the user used it', async () => {
    const tabId = await agentOpens('https://docs.example.com/a');
    const contents = contentsOf(tabId);
    contents.emit('before-mouse-event', {}, { type: 'mouseDown' });
    expect(panes.tab(CHAT, tabId)!.paneTab().kept).toBe(true);
    userCloses(tabId);
    expectClosed(tabId, contents);
    expect(await runBrowserOp(panes, { op: 'end_run', chatId: CHAT, runId: RUN }, signal)).toEqual(
      {},
    );
  });

  it('closes a tab waiting on a sign-in hand-off, and the release finds it gone', async () => {
    const tabId = await agentOpens('https://idp.example.com/login');
    await runBrowserOp(
      panes,
      { op: 'hand_over', chatId: CHAT, runId: RUN, tab: tabId, handoff },
      signal,
    );
    const contents = contentsOf(tabId);
    expect(userCloses(tabId)).toEqual({ handoff });
    expectClosed(tabId, contents);
    await expect(
      runBrowserOp(
        panes,
        { op: 'hand_over', chatId: CHAT, runId: RUN, tab: tabId, handoff: null },
        signal,
      ),
    ).rejects.toMatchObject({ code: 'no_tab' });
  });

  it('closes a page that asks to stay with beforeunload', async () => {
    const tabId = await userOpens('https://docs.example.com/draft');
    const contents = contentsOf(tabId);
    contents.blocksUnload = true;
    userCloses(tabId);
    expectClosed(tabId, contents);
  });

  it('closes a tab whose page crashed', async () => {
    const tabId = await userOpens('https://docs.example.com/a');
    const contents = contentsOf(tabId);
    contents.crash();
    expect(panes.tab(CHAT, tabId)!.paneTab().error).toBe('The page stopped working.');
    userCloses(tabId);
    expectClosed(tabId, contents);
  });

  it('drops the tab of a page that closed itself, and the other tabs still close', async () => {
    const signIn = await userOpens('https://idp.example.com/done');
    const other = await userOpens('https://docs.example.com/a');
    const gone = contentsOf(signIn);
    const contents = contentsOf(other);
    gone.close();
    expect(panes.tab(CHAT, signIn)).toBeNull();
    expect([...window.children].map((view) => view.webContents)).not.toContain(gone);
    userCloses(other);
    expectClosed(other, contents);
  });

  it('keeps no view when the tab is closed while its page is still opening', async () => {
    let finish: () => void = () => undefined;
    const enabling = new Promise<void>((started) => {
      net.answer = (method) => {
        if (method !== 'Page.enable') return {};
        started();
        return new Promise<void>((resolve) => (finish = resolve));
      };
    });
    const tab = panes.createTab(CHAT, { owner: 'user', runId: null, url: 'about:blank' }, home)!;
    const opening = tab.load('https://docs.example.com/a');
    await enabling;
    userCloses(tab.id);
    finish();
    await expect(opening).rejects.toThrow(TAB_CLOSED);
    expect(net.liveViews()).toEqual([]);
    expect(window.children.size).toBe(0);
  });

  it('tells an agent working on the tab that the user closed it', async () => {
    const tabId = await agentOpens('https://docs.example.com/a');
    const tab = panes.tab(CHAT, tabId)!;
    tab.sleep();
    userCloses(tabId);
    await expect(
      runBrowserOp(
        panes,
        { op: 'read', chatId: CHAT, runId: RUN, tab: tabId, mode: 'outline' } as never,
        signal,
      ),
    ).rejects.toMatchObject({ code: 'no_tab' });
    await expect(tab.wake()).rejects.toThrow(TAB_CLOSED);
  });

  it('sends the real tabs again when the pane asks to close a tab main no longer has', async () => {
    await userOpens('https://docs.example.com/a');
    panes.resync(CHAT);
    expect(pushed.at(-1)!.tabs.map((tab) => tab.url)).toEqual(['https://docs.example.com/a']);
  });
});

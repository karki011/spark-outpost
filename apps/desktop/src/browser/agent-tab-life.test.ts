import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runBrowserOp } from './agent-ops.ts';
import { net, type FakeContents } from './electron.fixture.ts';
import { BrowserPanes } from './panes.ts';

vi.mock('electron', async () => (await import('./electron.fixture.ts')).fakeElectron);
vi.mock('./cdp.ts', () => ({
  attachCdp: (contents: FakeContents) => contents.cdp,
}));

const CHAT = '11111111-2222-4333-8444-555555555555';
const RUN = '99999999-2222-4333-8444-555555555555';
const PROJECT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const home = { projectId: PROJECT, keepSignIns: true, roots: ['/Users/me/app'] };
const signal = new AbortController().signal;

let panes: BrowserPanes;

beforeEach(() => {
  net.reset();
  panes = new BrowserPanes({
    window: () => null,
    blockedPorts: () => new Set(),
    stateChanged: () => undefined,
    snapshot: () => undefined,
    localOriginSeen: () => undefined,
    contextMenu: () => undefined,
    addShortcut: () => undefined,
    log: () => undefined,
  });
});

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

function endTurn() {
  return runBrowserOp(panes, { op: 'end_run', chatId: CHAT, runId: RUN }, signal);
}

describe('agent tabs at the end of a turn', () => {
  it('closes an agent tab nobody touched, and says so on the tab', async () => {
    const tabId = await agentOpens('https://docs.example.com/a');
    expect(panes.tab(CHAT, tabId)!.paneTab()).toMatchObject({ owner: 'agent', kept: false });
    expect(await endTurn()).toEqual({ closed: 1 });
    expect(panes.tab(CHAT, tabId)).toBeNull();
  });

  it('keeps a tab the user clicked into or typed in during the turn', async () => {
    const clicked = await agentOpens('https://docs.example.com/a');
    const typed = await agentOpens('https://shop.example.com/b');
    contentsOf(clicked).emit('before-mouse-event', {}, { type: 'mouseDown' });
    contentsOf(typed).emit(
      'before-input-event',
      { preventDefault: () => undefined },
      {
        type: 'keyDown',
        key: 'a',
      },
    );
    expect(await endTurn()).toEqual({ closed: 0 });
    expect(panes.tab(CHAT, clicked)!.paneTab().kept).toBe(true);
    expect(panes.tab(CHAT, typed)!.paneTab().kept).toBe(true);
  });

  it('does not count the agent’s own input or a mouse move as the user’s', async () => {
    const tabId = await agentOpens('https://docs.example.com/a');
    const tab = panes.tab(CHAT, tabId)!;
    await panes.whileDriving(tab, async () => {
      contentsOf(tabId).emit('before-mouse-event', {}, { type: 'mouseDown' });
    });
    contentsOf(tabId).emit('before-mouse-event', {}, { type: 'mouseMove' });
    expect(tab.kept).toBe(false);
    expect(await endTurn()).toEqual({ closed: 1 });
  });

  it('keeps a tab Spark was asked to keep, and never recycles it for a new page', async () => {
    const tabId = await agentOpens('https://login.example.com/');
    expect(
      await runBrowserOp(panes, { op: 'keep', chatId: CHAT, runId: RUN, tab: tabId }, signal),
    ).toEqual({ kept: true });
    for (const site of ['a', 'b', 'c', 'd', 'e']) await agentOpens(`https://${site}.example.org/`);
    expect(panes.tab(CHAT, tabId)!.currentUrl()).toBe('https://login.example.com/');
    await endTurn();
    expect(panes.tab(CHAT, tabId)).not.toBeNull();
  });
});

describe('the page check before a sign-in', () => {
  it('waits for the page to settle and reports where it ended', async () => {
    const tabId = await agentOpens('https://app.example.com/');
    const contents = contentsOf(tabId);
    const asked = runBrowserOp(
      panes,
      { op: 'page', chatId: CHAT, runId: RUN, tab: tabId, settle: true },
      signal,
    ) as Promise<{ url: string }>;
    await new Promise((resolve) => setTimeout(resolve, 100));
    contents.cdpEmit('Page.frameStartedLoading');
    await new Promise((resolve) => setTimeout(resolve, 100));
    contents.url = 'https://auth.example.com/login';
    contents.cdpEmit('Page.loadEventFired');
    expect((await asked).url).toBe('https://auth.example.com/login');
  });
});

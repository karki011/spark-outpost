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
const home = { projectId: PROJECT, roots: ['/Users/me/app'] };
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
    paneShortcut: () => undefined,
    found: () => undefined,
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

describe('a tab handed to the user to sign in', () => {
  const handoff = {
    agent: 'Claude',
    site: 'https://idp.example.com',
    approvalId: '33333333-2222-4333-8444-555555555555',
  };

  it('shows the handoff, keeps the tab, refuses the agent and masks what the user typed after', async () => {
    const tabId = await agentOpens('https://idp.example.com/login');
    const handOver = (held: typeof handoff | null) =>
      runBrowserOp(
        panes,
        { op: 'hand_over', chatId: CHAT, runId: RUN, tab: tabId, handoff: held },
        signal,
      );
    await handOver(handoff);
    const tab = panes.tab(CHAT, tabId)!;
    expect(tab.paneTab()).toMatchObject({ handoff, kept: true, active: true });
    await expect(
      runBrowserOp(
        panes,
        { op: 'read', chatId: CHAT, runId: RUN, tab: tabId, mode: 'text', offset: 0 },
        signal,
      ),
    ).rejects.toMatchObject({ code: 'user_signing_in' });

    net.answer = (method) =>
      method === 'DOM.getDocument'
        ? {
            root: {
              backendNodeId: 1,
              nodeName: 'HTML',
              children: [
                { backendNodeId: 7, nodeName: 'INPUT', attributes: ['type', 'email'] },
                { backendNodeId: 8, nodeName: 'INPUT', attributes: ['type', 'checkbox'] },
                { backendNodeId: 9, nodeName: 'TEXTAREA' },
              ],
            },
          }
        : {};
    expect(await handOver(null)).toMatchObject({ masked: 2 });
    expect(tab.paneTab().handoff).toBeNull();
    expect([...tab.filled].sort()).toEqual([7, 9]);
    expect(await endTurn()).toEqual({ closed: 0 });
  });

  it('forgets what the page logged while the user was signing in', async () => {
    const tabId = await agentOpens('https://idp.example.com/login');
    const hand = (held: typeof handoff | null) =>
      runBrowserOp(
        panes,
        { op: 'hand_over', chatId: CHAT, runId: RUN, tab: tabId, handoff: held },
        signal,
      );
    await hand(handoff);
    contentsOf(tabId).cdpEmit('Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ type: 'string', value: 'typed hunter2' }],
    });
    await hand(null);
    const logged = (await runBrowserOp(
      panes,
      { op: 'logs', chatId: CHAT, runId: RUN, tab: tabId, kind: 'console', limit: 50 },
      signal,
    )) as { entries: { text: string }[] };
    expect(JSON.stringify(logged)).not.toContain('hunter2');
  });

  it('refuses to hand over a tab the user owns', async () => {
    const tab = panes.createTab(CHAT, {
      owner: 'user',
      runId: null,
      url: 'https://idp.example.com/',
    })!;
    await expect(
      runBrowserOp(
        panes,
        { op: 'hand_over', chatId: CHAT, runId: RUN, tab: tab.id, handoff },
        signal,
      ),
    ).rejects.toMatchObject({ code: 'not_allowed' });
    expect(tab.handoff).toBeNull();
  });

  it('lets go of a handoff made on a tab kept from an earlier turn when this turn ends', async () => {
    const tabId = await agentOpens('https://idp.example.com/login');
    await runBrowserOp(panes, { op: 'keep', chatId: CHAT, runId: RUN, tab: tabId }, signal);
    await endTurn();
    const next = '88888888-2222-4333-8444-555555555555';
    await runBrowserOp(
      panes,
      { op: 'hand_over', chatId: CHAT, runId: next, tab: tabId, handoff },
      signal,
    );
    await runBrowserOp(panes, { op: 'end_run', chatId: CHAT, runId: next }, signal);
    expect(panes.tab(CHAT, tabId)!.paneTab()).toMatchObject({ handoff: null, kept: true });
  });

  it('lets go of the handoff when the turn ends', async () => {
    const tabId = await agentOpens('https://idp.example.com/login');
    await runBrowserOp(
      panes,
      { op: 'hand_over', chatId: CHAT, runId: RUN, tab: tabId, handoff },
      signal,
    );
    await endTurn();
    expect(panes.tab(CHAT, tabId)!.paneTab()).toMatchObject({ handoff: null, kept: true });
  });
});

describe('storage in developer tools', () => {
  const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl';
  const storage = (tab: string) =>
    runBrowserOp(
      panes,
      { op: 'storage', chatId: CHAT, runId: RUN, tab, values: true },
      signal,
    ) as Promise<{
      valuesShown: boolean;
      local: { key: string; value?: string; masked?: true }[];
      cookies: { name: string; value?: string }[];
    }>;

  beforeEach(() => {
    net.answer = (method) => {
      if (method === 'DOMStorage.getDOMStorageItems') {
        return {
          entries: [
            ['theme', 'dark'],
            ['sb-abcd-auth-token', '{"user":"me"}'],
            ['persist:root', JSON.stringify({ user: JSON.stringify({ accessToken: 'x' }) })],
            ['last', JWT],
          ],
        };
      }
      if (method === 'Network.getCookies') {
        return {
          cookies: [
            {
              name: 'lang',
              value: 'en',
              domain: 'docs.example.com',
              path: '/',
              secure: true,
              httpOnly: false,
              session: true,
              expires: -1,
            },
            {
              name: 'sid',
              value: 'abc',
              domain: 'docs.example.com',
              path: '/',
              secure: true,
              httpOnly: true,
              session: true,
              expires: -1,
            },
          ],
        };
      }
      return {};
    };
  });

  it('shows plain values in an agent tab, masks auth-looking ones and never a cookie value', async () => {
    const agentTab = await agentOpens('https://docs.example.com/');
    const shown = await storage(agentTab);
    expect(shown.valuesShown).toBe(true);
    expect(shown.local.map(({ key, value, masked }) => ({ key, value, masked }))).toEqual([
      { key: 'theme', value: 'dark', masked: undefined },
      { key: 'sb-abcd-auth-token', value: undefined, masked: true },
      { key: 'persist:root', value: undefined, masked: true },
      { key: 'last', value: undefined, masked: true },
    ]);
    expect(shown.cookies.map((cookie) => cookie.name)).toEqual(['lang', 'sid']);
    for (const cookie of shown.cookies) expect(cookie).not.toHaveProperty('value');
  });

  it('shows no values at all in a tab the user owns', async () => {
    const mine = panes.createTab(CHAT, { owner: 'user', runId: null, url: 'about:blank' }, home)!;
    await mine.load('https://docs.example.com/');
    const shown = await storage(mine.id);
    expect(shown.valuesShown).toBe(false);
    expect(shown.local.length).toBeGreaterThan(0);
    for (const item of shown.local) expect(item).not.toHaveProperty('value');
  });
});

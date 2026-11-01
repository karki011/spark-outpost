import type { BrowserProfile } from '@spark-outpost/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { net, type FakeContents } from './electron.fixture.ts';
import { savedPageZooms } from './page-zoom.ts';
import { runPaneCommand } from './pane-command.ts';
import { BrowserPanes } from './panes.ts';
import type { PaneTab } from './tab.ts';
import { PIP_TOGGLE } from './tab-basics.ts';
import { memorySaved } from './view-host.fixture.ts';
import { parseSavedView } from './view-saved.ts';

vi.mock('electron', async () => (await import('./electron-ipc.fixture.ts')).fakeElectronWithIpc);
vi.mock('./cdp.ts', () => ({
  attachCdp: (contents: FakeContents) => contents.cdp,
}));

const CHAT = '11111111-2222-4333-8444-555555555555';
const DOCS = 'https://docs.example.com/guide';
const NEWS = 'https://news.example.com/';
const hooks = { tabsMax: 12 };

function makePanes(saved = memorySaved(), profile: (key: string) => BrowserProfile = () => 'work') {
  return new BrowserPanes({
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
    pageZooms: (key) => savedPageZooms(saved.store, profile(key), () => undefined),
  });
}

async function openTab(
  panes: BrowserPanes,
  url: string,
  key = CHAT,
  owner: 'user' | 'agent' = 'user',
) {
  const tab = panes.createTab(key, { owner, runId: owner === 'agent' ? 'run' : null, url })!;
  await tab.wake();
  return tab;
}

const contentsOf = (tab: PaneTab) => tab.contents() as unknown as FakeContents;
const run = (panes: BrowserPanes, tab: PaneTab, action: object, key = CHAT) =>
  runPaneCommand(panes, key, { tabId: tab.id, ...action } as never, hooks);

beforeEach(() => net.reset());

describe('mute', () => {
  it('mutes the tab and reports it, and keeps it across a sleep', async () => {
    const panes = makePanes();
    const tab = await openTab(panes, NEWS);
    expect(tab.paneTab().muted).toBe(false);
    await run(panes, tab, { command: 'mute', muted: true });
    expect(contentsOf(tab).audioMuted).toBe(true);
    expect(tab.paneTab().muted).toBe(true);
    tab.sleep();
    await tab.wake();
    expect(contentsOf(tab).audioMuted).toBe(true);
  });

  it('shows audible from the audio event, and clears it on sleep', async () => {
    const panes = makePanes();
    const tab = await openTab(panes, NEWS);
    contentsOf(tab).emit('audio-state-changed', { audible: true });
    expect(tab.paneTab().audible).toBe(true);
    contentsOf(tab).emit('audio-state-changed', { audible: false });
    expect(tab.paneTab().audible).toBe(false);
    contentsOf(tab).emit('audio-state-changed', { audible: true });
    tab.sleep();
    expect(tab.paneTab().audible).toBe(false);
  });
});

describe('page zoom', () => {
  it('puts a showing page back to 100% when saved zooms are cleared', async () => {
    const saved = memorySaved();
    const panes = makePanes(saved);
    const tab = await openTab(panes, DOCS);
    await run(panes, tab, { command: 'zoom', step: 'in' });
    tab.shown = true;
    saved.store.clearZooms('work');
    panes.syncZooms();
    expect(contentsOf(tab).zoomFactor).toBe(1);
    expect(tab.paneTab().zoom).toBe(1);
  });

  it('steps, remembers by origin, and applies on the next load there', async () => {
    const saved = memorySaved();
    const panes = makePanes(saved);
    const tab = await openTab(panes, DOCS);
    await run(panes, tab, { command: 'zoom', step: 'in' });
    expect(contentsOf(tab).zoomFactor).toBe(1.1);
    expect(tab.paneTab().zoom).toBe(1.1);
    expect(saved.profiles.work.zooms).toEqual({ 'https://docs.example.com': 1.1 });
    const other = await openTab(panes, NEWS);
    expect(other.paneTab().zoom).toBe(1);
    const again = await openTab(panes, 'https://docs.example.com/other');
    again.shown = true;
    contentsOf(again).emit('did-navigate', {}, 'https://docs.example.com/other', 200);
    expect(contentsOf(again).zoomFactor).toBe(1.1);
  });

  it('leaves the zoom alone when a tab off screen navigates, so the showing tab keeps it', async () => {
    const panes = makePanes();
    const hidden = await openTab(panes, 'http://localhost:5173/');
    const before = contentsOf(hidden).zoomFactor;
    contentsOf(hidden).zoomFactor = 1.5;
    contentsOf(hidden).emit('did-navigate', {}, 'http://localhost:5173/', 200);
    expect(contentsOf(hidden).zoomFactor).toBe(1.5);
    expect(before).toBe(1);
  });

  it('puts the factor back when a tab shows after another port moved the host', async () => {
    const panes = makePanes();
    const tab = await openTab(panes, 'http://localhost:3000/');
    await run(panes, tab, { command: 'zoom', step: 'in' });
    contentsOf(tab).zoomFactor = 2;
    tab.media.syncZoom();
    expect(contentsOf(tab).zoomFactor).toBe(1.1);
  });

  it('keeps Personal and Work apart, and shares Work across chats', async () => {
    const saved = memorySaved();
    const panes = makePanes(saved, (key) => (key === 'personal' ? 'personal' : 'work'));
    const personal = await openTab(panes, DOCS, 'personal');
    await run(panes, personal, { command: 'zoom', step: 'out' }, 'personal');
    expect(saved.profiles.personal.zooms).toEqual({ 'https://docs.example.com': 0.9 });
    expect(saved.profiles.work.zooms).toEqual({});
    const chat = await openTab(panes, DOCS);
    expect(chat.paneTab().zoom).toBe(1);
    await run(panes, chat, { command: 'zoom', step: 'in' });
    const other = await openTab(panes, DOCS, '99999999-2222-4333-8444-555555555555');
    expect(other.paneTab().zoom).toBe(1.1);
    expect(personal.paneTab().zoom).toBe(0.9);
  });

  it('does nothing on an empty tab', async () => {
    const saved = memorySaved();
    const panes = makePanes(saved);
    const tab = panes.createTab(CHAT, { owner: 'user', runId: null, url: 'about:blank' })!;
    await tab.ensure();
    await run(panes, tab, { command: 'zoom', step: 'in' });
    expect(saved.profiles.work.zooms).toEqual({});
    expect(tab.paneTab().zoom).toBe(1);
  });

  it('reads saved zooms back, dropping bad ones without losing the tabs', () => {
    const profile = (zooms: unknown) => ({
      tabs: [{ url: NEWS, title: 'News', pinned: false, active: true }],
      favorites: [],
      zooms,
    });
    const view = parseSavedView(
      JSON.stringify({
        version: 1,
        profiles: {
          personal: profile({ 'https://a.example.com': 1.5, 'not an origin': 2 }),
          work: profile({ 'https://b.example.com': 40 }),
        },
      }),
    );
    expect(view.profiles.personal.zooms).toEqual({ 'https://a.example.com': 1.5 });
    expect(view.profiles.work.zooms).toEqual({});
    expect(view.profiles.work.tabs).toHaveLength(1);
  });
});

describe('reopen a closed tab', () => {
  it('brings an agent tab back as the user’s, and stays in its own profile', async () => {
    const panes = makePanes();
    const agent = await openTab(panes, NEWS, CHAT, 'agent');
    await run(panes, agent, { command: 'close' });
    await runPaneCommand(panes, CHAT, { command: 'reopen' }, hooks);
    const [back] = panes.tabsOf(CHAT);
    expect(back?.owner).toBe('user');
    expect(back?.runId).toBeNull();
    expect(back?.currentUrl()).toBe(NEWS);

    const personal = await openTab(panes, DOCS, 'personal');
    await run(panes, personal, { command: 'close' }, 'personal');
    await runPaneCommand(panes, 'work', { command: 'reopen' }, hooks);
    expect(panes.tabsOf('work')).toEqual([]);
    await runPaneCommand(panes, 'personal', { command: 'reopen' }, hooks);
    expect(panes.tabsOf('personal').map((tab) => tab.currentUrl())).toEqual([DOCS]);
  });
});

describe('moving a tab', () => {
  it('reorders the list and leaves the owner alone', async () => {
    const panes = makePanes();
    const first = await openTab(panes, DOCS);
    const agent = await openTab(panes, NEWS, CHAT, 'agent');
    await run(panes, agent, { command: 'move', before: first.id });
    expect(panes.tabsOf(CHAT).map((tab) => tab.id)).toEqual([agent.id, first.id]);
    expect(agent.owner).toBe('agent');
    expect(agent.kept).toBe(false);
  });
});

describe('print and picture in picture', () => {
  const answers = (value: unknown) => {
    const expressions: { expression: unknown; contextId: unknown; userGesture: unknown }[] = [];
    net.answer = (method, params) => {
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'f' } } };
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 7 };
      if (method === 'Runtime.evaluate') {
        expressions.push({
          expression: params.expression,
          contextId: params.contextId,
          userGesture: params.userGesture,
        });
        return { result: { value } };
      }
      return {};
    };
    return expressions;
  };

  it('prints for the user and not while an agent call works on the tab', async () => {
    const panes = makePanes();
    const tab = await openTab(panes, NEWS);
    tab.agentBusy = 1;
    await run(panes, tab, { command: 'print' });
    expect(contentsOf(tab).printed).toBe(0);
    tab.agentBusy = 0;
    await run(panes, tab, { command: 'print' });
    expect(contentsOf(tab).printed).toBe(1);
  });

  it('runs the fixed toggle in an isolated world and reports the outcome', async () => {
    const panes = makePanes();
    const tab = await openTab(panes, NEWS);
    const expressions = answers('entered');
    expect(await run(panes, tab, { command: 'pip' })).toEqual({ pip: 'entered' });
    expect(expressions).toEqual([{ expression: PIP_TOGGLE, contextId: 7, userGesture: true }]);
  });

  it('refuses while an agent call works on the tab, and on an odd answer', async () => {
    const panes = makePanes();
    const tab = await openTab(panes, NEWS);
    const expressions = answers('whatever the page said');
    expect(await run(panes, tab, { command: 'pip' })).toEqual({ pip: 'refused' });
    tab.agentBusy = 1;
    expressions.length = 0;
    expect(await run(panes, tab, { command: 'pip' })).toEqual({ pip: 'refused' });
    expect(expressions).toEqual([]);
  });
});

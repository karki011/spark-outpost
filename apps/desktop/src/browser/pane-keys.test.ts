import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserShortcut } from '@spark-outpost/contracts';
import { net, type FakeContents } from './electron.fixture.ts';
import { BrowserPanes } from './panes.ts';
import type { PaneTab } from './tab.ts';

vi.mock('electron', async () => (await import('./electron.fixture.ts')).fakeElectron);
vi.mock('./cdp.ts', () => ({
  attachCdp: (contents: FakeContents) => contents.cdp,
}));

const CHAT = '11111111-2222-4333-8444-555555555555';
const home = { projectId: null, keepSignIns: true, roots: [] };
const mac = process.platform === 'darwin';
const WRITE = 'clipboard-sanitized-write';

const key = (code: string, change: Record<string, unknown> = {}) => ({
  type: 'keyDown',
  code,
  meta: mac,
  control: !mac,
  shift: false,
  alt: false,
  isComposing: false,
  ...change,
});

function pressed(contents: FakeContents, input: Record<string, unknown>): boolean {
  const event = { prevented: false, preventDefault: () => (event.prevented = true) };
  contents.emit('before-input-event', event, input);
  return event.prevented;
}

describe('pane tab keys and clipboard writes', () => {
  let panes: BrowserPanes;
  let shortcuts: [PaneTab, BrowserShortcut][];

  beforeEach(() => {
    net.reset();
    shortcuts = [];
    panes = new BrowserPanes({
      window: () => null,
      blockedPorts: () => new Set(),
      stateChanged: () => undefined,
      snapshot: () => undefined,
      localOriginSeen: () => undefined,
      contextMenu: () => undefined,
      addShortcut: () => undefined,
      paneShortcut: (tab, shortcut) => shortcuts.push([tab, shortcut]),
      found: () => undefined,
      log: () => undefined,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    panes.dispose();
  });

  async function opened(owner: 'user' | 'agent' = 'user') {
    const tab = panes.createTab(CHAT, { owner, runId: null, url: 'about:blank' }, home)!;
    await tab.load('https://example.com/');
    await show();
    const contents = tab.view()!.webContents as unknown as FakeContents;
    return { tab, contents, session: contents.session };
  }

  const show = (change: { bounds?: null; covered?: boolean } = {}) =>
    panes.place({
      chatId: CHAT,
      ...home,
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      covered: false,
      sendsTo: 'chat',
      ...change,
    });

  const click = (contents: FakeContents) =>
    contents.emit('before-mouse-event', {}, { type: 'mouseDown' });

  it('hands pane shortcuts pressed in the page to the host and keeps them from the page', async () => {
    const { tab, contents } = await opened();
    expect(pressed(contents, key('KeyT'))).toBe(true);
    expect(pressed(contents, key('KeyC', { shift: true }))).toBe(true);
    expect(pressed(contents, key('Tab', { meta: false, control: true }))).toBe(true);
    expect(shortcuts).toEqual([
      [tab, 'new_tab'],
      [tab, 'copy_url'],
      [tab, 'next_tab'],
    ]);
  });

  it('leaves close and reload to the app menu, which finds the focused tab', async () => {
    const { tab, contents } = await opened();
    expect(pressed(contents, key('KeyW'))).toBe(false);
    expect(pressed(contents, key('KeyR'))).toBe(false);
    expect(pressed(contents, key('KeyR', { shift: true }))).toBe(false);
    expect(shortcuts).toEqual([]);
    expect(panes.tabOfContents(contents as never)).toBe(tab);
    expect(panes.tabOfContents({ id: -1 } as never)).toBeNull();
    expect(panes.tabOfContents(null)).toBeNull();
  });

  it('leaves editing keys, composing keys and key ups to the page', async () => {
    const { contents } = await opened();
    for (const code of ['KeyC', 'KeyX', 'KeyV', 'KeyA', 'KeyZ']) {
      expect(pressed(contents, key(code)), code).toBe(false);
    }
    expect(pressed(contents, key('KeyT', { isComposing: true }))).toBe(false);
    expect(pressed(contents, key('KeyT', { type: 'keyUp' }))).toBe(false);
    expect(shortcuts).toEqual([]);
  });

  it('allows a clipboard write right after the user clicks in the showing tab', async () => {
    const { contents, session } = await opened();
    click(contents);
    expect(session.permissionAnswers(WRITE, contents)).toEqual({ request: true, check: true });
  });

  it('allows it after a key the user pressed, in an agent tab too', async () => {
    const { contents, session } = await opened('agent');
    pressed(contents, key('Enter', { meta: false, control: false }));
    expect(session.permissionAnswers(WRITE, contents)).toEqual({ request: true, check: true });
  });

  it('never allows reading the clipboard or any other permission', async () => {
    const { contents, session } = await opened();
    click(contents);
    for (const permission of [
      'clipboard-read',
      'deprecated-sync-clipboard-read',
      'notifications',
      'media',
    ]) {
      expect(session.permissionAnswers(permission, contents), permission).toEqual({
        request: false,
        check: false,
      });
    }
  });

  it('denies a write with no user input, or from contents that are not a pane tab', async () => {
    const { contents, session } = await opened();
    expect(session.permissionAnswers(WRITE, contents)).toEqual({ request: false, check: false });
    click(contents);
    expect(session.permissionAnswers(WRITE, null)).toEqual({ request: false, check: false });
    expect(session.permissionAnswers(WRITE, { id: -1 })).toEqual({ request: false, check: false });
  });

  it('denies a write while an agent acts on the tab and after it, until the user acts again', async () => {
    const { tab, contents, session } = await opened();
    click(contents);
    let during: unknown = null;
    await panes.whileDriving(tab, async () => {
      click(contents);
      during = session.permissionAnswers(WRITE, contents);
    });
    expect(during).toEqual({ request: false, check: false });
    expect(session.permissionAnswers(WRITE, contents)).toEqual({ request: false, check: false });
    await new Promise((resolve) => setTimeout(resolve, 2));
    click(contents);
    expect(session.permissionAnswers(WRITE, contents)).toEqual({ request: true, check: true });
  });

  it('answers a page copy command by the same rule and loads the copy guard', async () => {
    const { tab, contents, session } = await opened();
    const allowed = () => panes.pageCopyAllowed(contents as never);
    expect(session.preloads.some((file) => file.endsWith('copy-guard-preload.cjs'))).toBe(true);
    expect(allowed()).toBe(false);
    click(contents);
    expect(allowed()).toBe(true);
    let during = true;
    await panes.whileDriving(tab, async () => {
      during = allowed();
    });
    expect(during).toBe(false);
    expect(allowed()).toBe(false);
    expect(panes.pageCopyAllowed({ id: -1 } as never)).toBe(false);
  });

  it('runs no pane shortcut while an agent acts on the tab', async () => {
    const { tab, contents } = await opened();
    let prevented = true;
    await panes.whileDriving(tab, async () => {
      prevented = pressed(contents, key('KeyW'));
    });
    expect(prevented).toBe(false);
    expect(shortcuts).toEqual([]);
  });

  it('denies a write a few seconds after the last user input', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { contents, session } = await opened();
    click(contents);
    vi.advanceTimersByTime(5001);
    expect(session.permissionAnswers(WRITE, contents)).toEqual({ request: false, check: false });
  });

  it('denies a write once the pane is covered or closed, even right after a click', async () => {
    const { contents, session } = await opened();
    click(contents);
    await show({ covered: true });
    expect(session.permissionAnswers(WRITE, contents)).toEqual({ request: false, check: false });
    await show();
    expect(session.permissionAnswers(WRITE, contents)).toEqual({ request: true, check: true });
    await show({ bounds: null });
    expect(session.permissionAnswers(WRITE, contents)).toEqual({ request: false, check: false });
  });

  it('denies a write from a tab that is not the one showing', async () => {
    const first = await opened();
    click(first.contents);
    const second = await opened();
    panes.select(CHAT, second.tab.id);
    expect(first.session.permissionAnswers(WRITE, first.contents)).toEqual({
      request: false,
      check: false,
    });
  });
});

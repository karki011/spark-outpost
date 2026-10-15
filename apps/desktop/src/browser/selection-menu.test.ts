import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_SELECTED_TEXT_MAX } from '@spark-outpost/contracts';
import type { Cdp } from './cdp.ts';
import { net, type FakeContents } from './electron.fixture.ts';
import { BrowserPanes } from './panes.ts';
import {
  isAddShortcut,
  readPageSelection,
  selectedPageText,
  selectionMenuItems,
} from './selection-menu.ts';
import type { PaneTab } from './tab.ts';

vi.mock('electron', async () => (await import('./electron.fixture.ts')).fakeElectron);
vi.mock('./cdp.ts', () => ({
  attachCdp: (contents: FakeContents) => contents.cdp,
}));

const CHAT = '11111111-2222-4333-8444-555555555555';
const home = { projectId: null, keepSignIns: true, roots: [] };
const key = (change: Partial<Parameters<typeof isAddShortcut>[0]>) => ({
  type: 'keyDown',
  code: 'KeyA',
  meta: true,
  control: false,
  shift: true,
  alt: false,
  ...change,
});

describe('the selection menu', () => {
  it('offers Add to chat, Ask about this and Copy for selected page text', () => {
    const items = selectionMenuItems(
      { selectionText: 'Pricing', isEditable: false },
      false,
      'chat',
    );
    expect(items.map((item) => ('label' in item ? item.label : '—'))).toEqual([
      'Add to chat',
      'Ask about this',
      '—',
      'Copy',
    ]);
  });

  it('says Add to terminal in a Terminal session', () => {
    const [first] = selectionMenuItems(
      { selectionText: 'x', isEditable: false },
      false,
      'terminal',
    );
    expect(first).toEqual({ kind: 'send', label: 'Add to terminal', intent: 'add' });
  });

  it('shows nothing without a selection, in a field, or while selecting an element', () => {
    expect(selectionMenuItems({ selectionText: ' \n ', isEditable: false }, false, 'chat')).toEqual(
      [],
    );
    expect(
      selectionMenuItems({ selectionText: 'me@x.io', isEditable: true }, false, 'chat'),
    ).toEqual([]);
    expect(
      selectionMenuItems({ selectionText: 'Pricing', isEditable: false }, true, 'chat'),
    ).toEqual([]);
  });
});

describe('selected page text', () => {
  it('drops control characters, keeps lines and trims', () => {
    expect(selectedPageText('  one\r\ntwo\u001b[31m\u0007\n\n\n\nthree  ')).toBe(
      'one\ntwo[31m\n\nthree',
    );
  });

  it('caps the length', () => {
    const text = selectedPageText('a'.repeat(BROWSER_SELECTED_TEXT_MAX + 50))!;
    expect(text).toHaveLength(BROWSER_SELECTED_TEXT_MAX);
    expect(text.endsWith('…')).toBe(true);
  });

  it('redacts secret-looking values', () => {
    const text = selectedPageText('token ghp_abcdefghijklmnopqrstuvwxyz0123456789')!;
    expect(text).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });
});

describe('the add shortcut', () => {
  it('is Command-Shift-A on a Mac and Control-Shift-A elsewhere', () => {
    expect(isAddShortcut(key({}), 'darwin')).toBe(true);
    expect(isAddShortcut(key({ meta: false, control: true }), 'linux')).toBe(true);
    expect(isAddShortcut(key({ meta: false, control: true }), 'darwin')).toBe(false);
    expect(isAddShortcut(key({ alt: true }), 'darwin')).toBe(false);
    expect(isAddShortcut(key({ type: 'keyUp' }), 'darwin')).toBe(false);
    expect(isAddShortcut(key({ code: 'KeyB' }), 'darwin')).toBe(false);
  });
});

describe('reading the selection for the shortcut', () => {
  it('reads it in an isolated world of the main frame', async () => {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    const answers: Record<string, unknown> = {
      'Page.getFrameTree': { frameTree: { frame: { id: 'main' } } },
      'Page.createIsolatedWorld': { executionContextId: 7 },
      'Runtime.evaluate': { result: { value: 'Selected words' } },
    };
    const cdp: Cdp = {
      send: (method, params) => {
        calls.push([method, params]);
        return Promise.resolve(answers[method] as never);
      },
      listen: () => () => undefined,
      detach: () => undefined,
    };
    expect(await readPageSelection(cdp)).toBe('Selected words');
    expect(calls[1]).toEqual([
      'Page.createIsolatedWorld',
      { frameId: 'main', worldName: 'spark-selection' },
    ]);
    expect(calls[2]![1]).toMatchObject({ contextId: 7, returnByValue: true });
  });
});

describe('a pane tab', () => {
  let menus: PaneTab[];
  let shortcuts: PaneTab[];
  let panes: BrowserPanes;

  beforeEach(() => {
    net.reset();
    menus = [];
    shortcuts = [];
    panes = new BrowserPanes({
      window: () => null,
      blockedPorts: () => new Set(),
      stateChanged: () => undefined,
      snapshot: () => undefined,
      localOriginSeen: () => undefined,
      contextMenu: (tab) => menus.push(tab),
      addShortcut: (tab) => shortcuts.push(tab),
      log: () => undefined,
    });
  });

  async function opened() {
    const tab = panes.createTab(CHAT, { owner: 'user', runId: null, url: 'about:blank' }, home)!;
    await tab.load('https://example.com/');
    return { tab, contents: tab.view()!.webContents as unknown as FakeContents };
  }

  it('hands a right click and the add shortcut to the host', async () => {
    const { tab, contents } = await opened();
    contents.emit('context-menu', {}, { selectionText: 'Hello', isEditable: false });
    const event = { prevented: false, preventDefault: () => (event.prevented = true) };
    contents.emit(
      'before-input-event',
      event,
      key(process.platform === 'darwin' ? {} : { meta: false, control: true }),
    );
    expect(menus).toEqual([tab]);
    expect(shortcuts).toEqual([tab]);
    expect(event.prevented).toBe(true);
  });

  it('lets other keys reach the page', async () => {
    const { contents } = await opened();
    const event = { prevented: false, preventDefault: () => (event.prevented = true) };
    contents.emit('before-input-event', event, key({ code: 'KeyC' }));
    expect(event.prevented).toBe(false);
    expect(shortcuts).toEqual([]);
  });

  it('remembers whether the chat sends to the terminal from the placement', async () => {
    expect(panes.sendsTo(CHAT)).toBe('chat');
    await panes.place({
      chatId: CHAT,
      ...home,
      bounds: null,
      covered: false,
      sendsTo: 'terminal',
    });
    expect(panes.sendsTo(CHAT)).toBe('terminal');
  });
});

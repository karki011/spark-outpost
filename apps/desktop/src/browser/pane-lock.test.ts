import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appLockGate } from '../app-lock-gate.ts';
import { net, type FakeContents, type FakeView } from './electron.fixture.ts';
import { BrowserPanes } from './panes.ts';

vi.mock('electron', async () => (await import('./electron.fixture.ts')).fakeElectron);
vi.mock('./cdp.ts', () => ({
  attachCdp: (contents: FakeContents) => contents.cdp,
}));

const CHAT = '11111111-2222-4333-8444-555555555555';
const home = { projectId: null, roots: [] };

const setLocked = (locked: boolean) =>
  appLockGate.publish({ locked, available: true, hideNotifications: true });

describe('browser pane pages while Spark Outpost is locked', () => {
  let panes: BrowserPanes;
  let snapshots: (string | null)[];

  beforeEach(() => {
    net.reset();
    snapshots = [];
    panes = new BrowserPanes({
      window: () => null,
      blockedPorts: () => new Set(),
      stateChanged: () => undefined,
      snapshot: (_chatId, image) => snapshots.push(image),
      localOriginSeen: () => undefined,
      contextMenu: () => undefined,
      addShortcut: () => undefined,
      paneShortcut: () => undefined,
      found: () => undefined,
      log: () => undefined,
    });
  });

  afterEach(() => {
    setLocked(false);
    panes.dispose();
  });

  const show = (covered = false) =>
    panes.place({
      chatId: CHAT,
      ...home,
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      covered,
      sendsTo: 'chat',
    });

  async function opened() {
    const tab = panes.createTab(CHAT, { owner: 'user', runId: null, url: 'about:blank' }, home)!;
    await tab.load('https://example.com/');
    await show();
    const view = tab.view() as unknown as FakeView;
    const capturePage = vi.fn(async () => ({
      isEmpty: () => false,
      toJPEG: () => Buffer.from('page'),
    }));
    Object.assign(view.webContents, { capturePage });
    return { tab, view, capturePage };
  }

  it('hides the page on lock and shows it again on unlock', async () => {
    const { tab, view } = await opened();
    expect(view.visible).toBe(true);
    setLocked(true);
    panes.layout();
    expect(view.visible).toBe(false);
    expect(tab.shown).toBe(false);
    setLocked(false);
    panes.layout();
    expect(view.visible).toBe(true);
  });

  it('keeps a page hidden when it is placed while locked', async () => {
    const { view } = await opened();
    setLocked(true);
    await show();
    expect(view.visible).toBe(false);
  });

  it('takes and sends no picture of the page when it is covered while locked', async () => {
    const { tab, capturePage } = await opened();
    setLocked(true);
    panes.layout();
    await show(true);
    expect(await panes.capture(tab)).toBeNull();
    expect(capturePage).not.toHaveBeenCalled();
    expect(snapshots.filter((image) => image !== null)).toEqual([]);
  });

  it('still sends the covered picture when it is not locked', async () => {
    const { capturePage } = await opened();
    await show(true);
    expect(capturePage).toHaveBeenCalledTimes(1);
    expect(snapshots.at(-1)).toMatch(/^data:image\/jpeg;base64,/);
  });
});

import { runInNewContext } from 'node:vm';
import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { recordUiDiagnostics, UI_DIAGNOSTICS_SCRIPT } from './ui-diagnostics.ts';

function element(selectors: string[], opacity = '1') {
  return {
    id: 'private-ticket-id',
    textContent: 'private meeting title',
    innerHTML: '<input value="private-secret">',
    value: 'private-secret',
    style: { display: 'flex', visibility: 'visible', opacity, pointerEvents: 'auto' },
    matches: (selector: string) => selectors.includes(selector),
    closest: (selector: string) => (selector.includes('.dlg') ? node : null),
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
  };
}

const node = element(['.dlg']);

function snapshot(candidates = [node]) {
  return runInNewContext(UI_DIAGNOSTICS_SCRIPT, {
    document: {
      querySelectorAll: () => candidates,
      elementFromPoint: () => node,
    },
    getComputedStyle: (item: ReturnType<typeof element>) => item.style,
    innerWidth: 1000,
    innerHeight: 800,
  });
}

function windowAt(url: string, result: unknown = snapshot()): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      getURL: () => url,
      executeJavaScript: vi.fn(async () => result),
    },
  } as unknown as BrowserWindow;
}

describe('UI diagnostics', () => {
  it('records an intercepting scrim and invisible panel without content or identities', () => {
    const result = snapshot([node, element(['[role="dialog"]'], '0')]);
    expect(result.overlays).toMatchObject([
      { selectors: ['.dlg'], opacity: '1', rect: [0, 0, 1000, 800] },
      { selectors: ['[role="dialog"]'], opacity: '0' },
    ]);
    expect(result.hitTests).toHaveLength(9);
    expect(result.hitTests[4]).toMatchObject({
      point: [0.5, 0.5],
      blocker: { selectors: ['.dlg'] },
    });
    expect(JSON.stringify(result)).not.toMatch(/private|textContent|innerHTML|value/);
  });

  it('bounds overlay collection', () => {
    const result = snapshot(Array.from({ length: 40 }, () => node));
    expect(result.overlays).toHaveLength(24);
    expect(result.truncated).toBe(true);
  });

  it('records only the supplied trusted main and settings routes', async () => {
    const log = vi.fn();
    const main = windowAt('http://localhost:1234/');
    const settings = windowAt('http://localhost:1234/settings#/help');
    await recordUiDiagnostics(
      [
        { kind: 'main', window: main },
        { kind: 'settings', window: settings },
      ],
      'http://localhost:1234',
      log,
    );
    expect(main.webContents.executeJavaScript).toHaveBeenCalledWith(UI_DIAGNOSTICS_SCRIPT);
    expect(settings.webContents.executeJavaScript).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/localhost|private/);
    const unrelated = windowAt('https://example.com/settings');
    const pane = windowAt('http://localhost:1234/island');
    await recordUiDiagnostics(
      [
        { kind: 'main', window: unrelated },
        { kind: 'settings', window: pane },
      ],
      'http://localhost:1234',
      log,
    );
    expect(unrelated.webContents.executeJavaScript).not.toHaveBeenCalled();
    expect(pane.webContents.executeJavaScript).not.toHaveBeenCalled();
  });

  it('does not expose renderer errors or block export when collection fails', async () => {
    const main = windowAt('http://localhost:1234/');
    vi.mocked(main.webContents.executeJavaScript).mockRejectedValue(new Error('private content'));
    const log = vi.fn();
    await recordUiDiagnostics([{ kind: 'main', window: main }], 'http://localhost:1234', log);
    expect(log).toHaveBeenCalledWith('[ui-diagnostics] main unavailable');
  });

  it('continues export when a renderer does not respond', async () => {
    vi.useFakeTimers();
    try {
      const main = windowAt('http://localhost:1234/');
      vi.mocked(main.webContents.executeJavaScript).mockReturnValue(new Promise(() => undefined));
      const log = vi.fn();
      const pending = recordUiDiagnostics(
        [{ kind: 'main', window: main }],
        'http://localhost:1234',
        log,
      );
      await vi.advanceTimersByTimeAsync(1500);
      await pending;
      expect(log).toHaveBeenCalledWith('[ui-diagnostics] main unavailable');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([
    ['unexpected content', () => ({ ...snapshot(), secret: 'private-content' })],
    [
      'arbitrary selector',
      () => ({
        ...snapshot(),
        overlays: [{ ...snapshot().overlays[0], selectors: ['private-content'] }],
      }),
    ],
    [
      'arbitrary style',
      () => ({
        ...snapshot(),
        overlays: [{ ...snapshot().overlays[0], display: 'private-content' }],
      }),
    ],
    [
      'non-finite rectangle',
      () => ({
        ...snapshot(),
        overlays: [{ ...snapshot().overlays[0], rect: [0, 0, Infinity, 800] }],
      }),
    ],
    [
      'oversize overlays',
      () => ({ ...snapshot(), overlays: Array.from({ length: 25 }, () => snapshot().overlays[0]) }),
    ],
    [
      'oversize hit tests',
      () => ({ ...snapshot(), hitTests: Array.from({ length: 10 }, () => snapshot().hitTests[0]) }),
    ],
    [
      'oversize opacity',
      () => ({
        ...snapshot(),
        overlays: [{ ...snapshot().overlays[0], opacity: '0.' + '1'.repeat(100000) }],
      }),
    ],
    [
      'nested content',
      () => ({
        ...snapshot(),
        hitTests: [
          {
            ...snapshot().hitTests[0],
            target: { ...snapshot().overlays[0], text: 'private-content' },
          },
        ],
      }),
    ],
  ])('rejects %s from renderer before logging', async (_name, result) => {
    const log = vi.fn();
    await recordUiDiagnostics(
      [{ kind: 'main', window: windowAt('http://localhost:1234/', result()) }],
      'http://localhost:1234',
      log,
    );
    expect(log).toHaveBeenCalledExactlyOnceWith('[ui-diagnostics] main unavailable');
  });

  it('bounds concurrent captures per window even after the export times out', async () => {
    vi.useFakeTimers();
    try {
      let resolve!: (result: unknown) => void;
      const main = windowAt('http://localhost:1234/');
      vi.mocked(main.webContents.executeJavaScript).mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const log = vi.fn();
      const windows = [{ kind: 'main' as const, window: main }];
      const first = recordUiDiagnostics(windows, 'http://localhost:1234', log);
      await recordUiDiagnostics(windows, 'http://localhost:1234', log);
      expect(main.webContents.executeJavaScript).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1500);
      await first;
      await recordUiDiagnostics(windows, 'http://localhost:1234', log);
      expect(main.webContents.executeJavaScript).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      resolve(snapshot());
      await vi.advanceTimersByTimeAsync(0);
      await recordUiDiagnostics(windows, 'http://localhost:1234', log);
      expect(main.webContents.executeJavaScript).toHaveBeenCalledTimes(2);
      expect(log.mock.calls.at(-1)?.[0]).toContain('"viewport":[1000,800]');
    } finally {
      vi.useRealTimers();
    }
  });
});

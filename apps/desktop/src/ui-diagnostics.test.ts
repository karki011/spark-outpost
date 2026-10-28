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
});

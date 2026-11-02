import { describe, expect, it, vi } from 'vitest';
import type { Cdp } from './cdp.ts';
import { capturePage } from './page-tools.ts';

vi.mock('electron', async () => (await import('./electron.fixture.ts')).fakeElectron);

function cdpAt(zoom: number | undefined, clips: unknown[]): Cdp {
  return {
    send: ((method: string, params: { clip?: unknown }) => {
      if (method === 'Page.getLayoutMetrics') {
        return Promise.resolve({
          cssVisualViewport: { pageX: 10, pageY: 20, clientWidth: 400, clientHeight: 300, zoom },
          cssContentSize: { width: 400, height: 900 },
        });
      }
      if (method === 'Page.captureScreenshot') {
        clips.push(params.clip);
        return Promise.reject(new Error('stop'));
      }
      return Promise.resolve({});
    }) as Cdp['send'],
    listen: () => () => undefined,
    detach: () => undefined,
  };
}

describe('capturing a zoomed page', () => {
  it.each([
    [undefined, 1],
    [1.5, 1.5],
    [0.5, 0.5],
  ])('scales the clip by the page zoom (%s)', async (zoom, scale) => {
    const clips: unknown[] = [];
    await expect(capturePage(cdpAt(zoom, clips), {})).rejects.toThrow('stop');
    expect(clips).toEqual([
      { x: 10 * scale, y: 20 * scale, width: 400 * scale, height: 300 * scale, scale: 1 },
    ]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { noActivate } from './no-activate.ts';

const handle = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
const window = { isDestroyed: () => false, getNativeWindowHandle: () => handle };

describe('noActivate', () => {
  it('hands each window handle to the addon', () => {
    const preventActivation = vi.fn(() => 'applied');
    const log = vi.fn();
    const apply = noActivate('/addon.node', log, () => ({ preventActivation }));
    apply(window);
    apply(window);
    expect(preventActivation).toHaveBeenCalledTimes(2);
    expect(preventActivation).toHaveBeenCalledWith(handle);
    expect(log).not.toHaveBeenCalled();
  });

  it('skips a window that is already gone', () => {
    const preventActivation = vi.fn(() => 'applied');
    const apply = noActivate('/addon.node', vi.fn(), () => ({ preventActivation }));
    apply({ isDestroyed: () => true, getNativeWindowHandle: () => handle });
    expect(preventActivation).not.toHaveBeenCalled();
  });

  it('falls back to doing nothing, with one log line, when the addon is not built', () => {
    const log = vi.fn();
    const apply = noActivate('/missing.node', log, () => {
      throw new Error('Cannot find module');
    });
    apply(window);
    apply(window);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain('/missing.node');
    expect(log.mock.calls[0]?.[0]).toContain('pnpm desktop:no-activate');
  });

  it('refuses something that is not the addon', () => {
    const log = vi.fn();
    noActivate('/other.node', log, () => ({}))(window);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain('no preventActivation');
  });

  it('logs once when this macOS has no way to keep a window from activating Spark', () => {
    const log = vi.fn();
    const apply = noActivate('/addon.node', log, () => ({
      preventActivation: () => 'unsupported',
    }));
    apply(window);
    apply(window);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain('unsupported');
  });
});

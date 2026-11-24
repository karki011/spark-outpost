import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followWebglRenderer } from './webgl-renderer.ts';

const addons: { dispose: ReturnType<typeof vi.fn>; lose: () => void }[] = [];

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    private lost: (() => void) | null = null;
    dispose = vi.fn();
    constructor() {
      addons.push({ dispose: this.dispose, lose: () => this.lost?.() });
    }
    onContextLoss(listener: () => void) {
      this.lost = listener;
    }
  },
}));

let show: (visible: boolean) => void = () => undefined;
const disconnect = vi.fn();

beforeEach(() => {
  addons.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        show = (visible) => callback([{ isIntersecting: visible }]);
      }
      observe() {}
      disconnect = disconnect;
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('followWebglRenderer', () => {
  const terminal = { loadAddon: vi.fn() } as never;
  const element = {} as HTMLElement;

  it('releases the renderer while the terminal is off screen and loads it again when shown', () => {
    const stop = followWebglRenderer(terminal, element);
    expect(addons).toHaveLength(1);
    show(false);
    expect(addons[0]!.dispose).toHaveBeenCalledTimes(1);
    show(false);
    show(true);
    show(true);
    expect(addons).toHaveLength(2);
    stop();
    expect(addons[1]!.dispose).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalled();
  });

  it('loads the renderer again after a lost context, a few times at most', () => {
    const stop = followWebglRenderer(terminal, element);
    for (let loss = 0; loss < 5; loss++) {
      addons.at(-1)!.lose();
      vi.runAllTimers();
    }
    expect(addons).toHaveLength(3);
    stop();
  });

  it('does not reload a lost renderer while off screen', () => {
    const stop = followWebglRenderer(terminal, element);
    show(false);
    addons[0]!.lose();
    vi.runAllTimers();
    expect(addons).toHaveLength(1);
    show(true);
    expect(addons).toHaveLength(2);
    stop();
  });
});

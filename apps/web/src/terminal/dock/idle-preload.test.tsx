// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let preloads = 0;

async function freshHook() {
  vi.resetModules();
  vi.doMock('../terminal-connection.ts', () => ({
    preloadTerminal: () => {
      preloads += 1;
      return Promise.resolve();
    },
  }));
  const { useTerminalIdlePreload } = await import('./idle-preload.ts');
  return function Chat({ preload }: { preload: boolean }) {
    useTerminalIdlePreload(preload);
    return null;
  };
}

beforeEach(() => {
  preloads = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('loading the terminal code while the main window is idle', () => {
  it('waits for an idle moment, then loads once for every chat with a project', async () => {
    const idle: IdleRequestCallback[] = [];
    const asked: (IdleRequestOptions | undefined)[] = [];
    vi.stubGlobal(
      'requestIdleCallback',
      (call: IdleRequestCallback, options?: IdleRequestOptions) => {
        idle.push(call);
        asked.push(options);
        return idle.length;
      },
    );
    const Chat = await freshHook();
    const first = render(<Chat preload />);
    expect(preloads).toBe(0);
    idle[0]?.({ didTimeout: false, timeRemaining: () => 10 });
    expect(preloads).toBe(1);

    first.unmount();
    render(<Chat preload />);
    render(<Chat preload />);
    expect(idle).toHaveLength(1);
    expect(preloads).toBe(1);
    expect(asked[0]?.timeout).toBeGreaterThan(0);
  });

  it('loads nothing for a chat without a project', async () => {
    const idle = vi.fn();
    vi.stubGlobal('requestIdleCallback', idle);
    const Chat = await freshHook();
    render(<Chat preload={false} />);
    await vi.runAllTimersAsync();
    expect(idle).not.toHaveBeenCalled();
    expect(preloads).toBe(0);
  });

  it('starts once a project is linked to a chat that had none', async () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    const Chat = await freshHook();
    const view = render(<Chat preload={false} />);
    view.rerender(<Chat preload />);
    expect(preloads).toBe(0);
    await vi.runAllTimersAsync();
    expect(preloads).toBe(1);
  });

  it('falls back to a short delay where the browser has no idle callback', async () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    const Chat = await freshHook();
    render(<Chat preload />);
    render(<Chat preload />);
    expect(preloads).toBe(0);
    await vi.runAllTimersAsync();
    expect(preloads).toBe(1);
  });
});

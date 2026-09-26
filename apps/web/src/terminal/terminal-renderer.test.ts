import { describe, expect, it, vi } from 'vitest';

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    constructor() {
      throw new Error('WebGL is not available');
    }
  },
}));

describe('loadWebglRenderer', () => {
  it('falls back to the default renderer when WebGL is unavailable', async () => {
    const { loadWebglRenderer } = await import('./terminal-connection.ts');
    const terminal = { loadAddon: vi.fn() };
    expect(loadWebglRenderer(terminal as never)).toBeNull();
    expect(terminal.loadAddon).not.toHaveBeenCalled();
  });
});

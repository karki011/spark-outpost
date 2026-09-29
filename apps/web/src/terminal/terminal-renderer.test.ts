import { describe, expect, it, vi } from 'vitest';
import { loadWebglRenderer } from './terminal-connection.ts';

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    constructor() {
      throw new Error('WebGL is not available');
    }
  },
}));

describe('loadWebglRenderer', () => {
  it('falls back to the default renderer when WebGL is unavailable', () => {
    const terminal = { loadAddon: vi.fn() };
    expect(loadWebglRenderer(terminal as never)).toBeNull();
    expect(terminal.loadAddon).not.toHaveBeenCalled();
  });
});

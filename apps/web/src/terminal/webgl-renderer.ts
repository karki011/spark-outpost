import { WebglAddon } from '@xterm/addon-webgl';
import type { Terminal } from '@xterm/xterm';

const MAX_CONTEXT_LOSSES = 3;

export function loadWebglRenderer(terminal: Terminal, onLoss?: () => void): WebglAddon | null {
  let addon: WebglAddon;
  try {
    addon = new WebglAddon();
  } catch {
    return null;
  }
  addon.onContextLoss(() => {
    addon.dispose();
    onLoss?.();
  });
  try {
    terminal.loadAddon(addon);
  } catch {
    addon.dispose();
    return null;
  }
  return addon;
}

export function followWebglRenderer(terminal: Terminal, element: HTMLElement): () => void {
  let addon: WebglAddon | null = null;
  let visible = true;
  let losses = 0;
  let stopped = false;

  const unload = () => {
    const loaded = addon;
    addon = null;
    loaded?.dispose();
  };
  const load = () => {
    if (addon || !visible || stopped || losses >= MAX_CONTEXT_LOSSES) return;
    addon = loadWebglRenderer(terminal, () => {
      addon = null;
      losses += 1;
      setTimeout(load, 0);
    });
  };

  load();
  const observer =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          const shown = entries.at(-1)?.isIntersecting ?? visible;
          if (shown === visible) return;
          visible = shown;
          if (visible) load();
          else unload();
        })
      : null;
  observer?.observe(element);

  return () => {
    stopped = true;
    observer?.disconnect();
    unload();
  };
}

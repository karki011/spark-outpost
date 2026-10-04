import type { WebContents } from 'electron';

export type CdpListener = (method: string, params: Record<string, unknown>) => void;

export interface Cdp {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T>;
  listen(listener: CdpListener): () => void;
  detach(): void;
}

export function attachCdp(contents: WebContents): Cdp {
  const listeners = new Set<CdpListener>();
  contents.debugger.attach('1.3');
  contents.debugger.on('message', (_event, method, params) => {
    for (const listener of listeners) listener(method, params as Record<string, unknown>);
  });
  return {
    send: (method, params) => contents.debugger.sendCommand(method, params) as Promise<never>,
    listen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    detach() {
      listeners.clear();
      if (contents.isDestroyed() || !contents.debugger.isAttached()) return;
      contents.debugger.detach();
    },
  };
}

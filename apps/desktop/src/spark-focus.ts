type Listener = (...args: never[]) => void;

export interface ClosingWindow {
  once(event: 'closed', listener: () => void): unknown;
}

export interface FocusSource {
  on(event: string, listener: Listener): unknown;
  off(event: string, listener: Listener): unknown;
}

export const FOCUS_EVENTS = [
  'browser-window-focus',
  'browser-window-blur',
  'did-become-active',
  'did-resign-active',
] as const;

export function watchSparkFocus(
  source: FocusSource,
  open: readonly ClosingWindow[],
  changed: () => void,
): () => void {
  const onCreated = (_event: unknown, window: ClosingWindow) => window.once('closed', changed);
  for (const window of open) window.once('closed', changed);
  for (const name of FOCUS_EVENTS) source.on(name, changed);
  source.on('browser-window-created', onCreated as Listener);
  return () => {
    for (const name of FOCUS_EVENTS) source.off(name, changed);
    source.off('browser-window-created', onCreated as Listener);
  };
}

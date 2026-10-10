import type { TerminalEndReason, TerminalHint } from '@spark-outpost/contracts';
import type { TerminalTicket } from './terminal-api.ts';
import type * as Xterm from './xterm-terminal.ts';

export interface TerminalHandlers<T extends TerminalTicket> {
  onOpen(created: T): void;
  preserveSession?: boolean;
  readOnly?: boolean;
  onDisconnected?(): void;
  onCommandRun?(): void;
  onHint?(hint: TerminalHint): void;
  onEnded(reason: TerminalEndReason): void;
  onError(message: string): void;
  onInputError?(message: string): void;
}

export interface TerminalConnection {
  run(): void;
  notice(text: string): void;
  fit(): void;
  focus(): void;
  close(): void;
  dispose(): void;
}

const LOAD_FAILED = 'The terminal could not load. Close it and open it again.';
const SKELETON_LINES = ['38%', '64%', '22%'];

let loading: Promise<typeof Xterm> | null = null;

export function preloadTerminal(): Promise<typeof Xterm> {
  loading ??= import('./xterm-terminal.ts');
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

function showSkeleton(element: HTMLElement): HTMLElement {
  const skeleton = document.createElement('div');
  skeleton.className = 'term-skel';
  skeleton.setAttribute('aria-hidden', 'true');
  for (const width of SKELETON_LINES) {
    const line = document.createElement('span');
    line.style.width = width;
    skeleton.append(line);
  }
  element.append(skeleton);
  return skeleton;
}

export function openTerminal<T extends TerminalTicket>(
  start: () => Promise<T>,
  element: HTMLElement,
  handlers: TerminalHandlers<T>,
): TerminalConnection {
  let opened: TerminalConnection | null = null;
  let disposed = false;
  let waiting: ((connection: TerminalConnection) => void)[] = [];
  const skeleton = showSkeleton(element);

  preloadTerminal().then(
    (xterm) => {
      skeleton.remove();
      if (disposed) return;
      const connection = xterm.openXterm(start, element, handlers);
      opened = connection;
      for (const call of waiting) call(connection);
      waiting = [];
    },
    () => {
      skeleton.remove();
      if (!disposed) handlers.onError(LOAD_FAILED);
    },
  );

  const whenOpen = (call: (connection: TerminalConnection) => void) => {
    if (opened) call(opened);
    else if (!disposed) waiting.push(call);
  };

  return {
    run: () => whenOpen((connection) => connection.run()),
    notice: (text) => whenOpen((connection) => connection.notice(text)),
    fit: () => whenOpen((connection) => connection.fit()),
    focus: () => whenOpen((connection) => connection.focus()),
    close: () => whenOpen((connection) => connection.close()),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      waiting = [];
      skeleton.remove();
      opened?.dispose();
    },
  };
}

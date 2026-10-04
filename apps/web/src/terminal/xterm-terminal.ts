import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { terminalServerMessageSchema, type TerminalClientMessage } from '@spark-outpost/contracts';
import { deleteTerminalSession, streamUrl, type TerminalTicket } from './terminal-api.ts';
import type { TerminalConnection, TerminalHandlers } from './terminal-connection.ts';
import { lineEditingSequence } from './terminal-keys.ts';
import { openTerminalLink } from './terminal-links.ts';
import { themeFromTokens } from './terminal-theme.ts';

const OSC_CLIPBOARD = 52;
const encoder = new TextEncoder();

export function loadWebglRenderer(terminal: Terminal): WebglAddon | null {
  let addon: WebglAddon;
  try {
    addon = new WebglAddon();
  } catch {
    return null;
  }
  addon.onContextLoss(() => addon.dispose());
  try {
    terminal.loadAddon(addon);
  } catch {
    addon.dispose();
    return null;
  }
  return addon;
}

function createTerminal(): Terminal {
  return new Terminal({
    fontFamily: '"Geist Mono", ui-monospace, Menlo, monospace',
    fontSize: 12.5,
    lineHeight: 1.25,
    cursorBlink: true,
    scrollback: 5000,
    minimumContrastRatio: 4.5,
    screenReaderMode: true,
    theme: themeFromTokens(),
    linkHandler: { activate: (event, uri) => openTerminalLink(event, uri) },
  });
}

export function openXterm<T extends TerminalTicket>(
  start: () => Promise<T>,
  element: HTMLElement,
  handlers: TerminalHandlers<T>,
): TerminalConnection {
  const abort = new AbortController();
  const terminal = createTerminal();
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.loadAddon(new WebLinksAddon((event, uri) => openTerminalLink(event, uri)));
  terminal.open(element);
  const webgl = loadWebglRenderer(terminal);
  terminal.parser.registerOscHandler(OSC_CLIPBOARD, () => true);

  let socket: WebSocket | null = null;
  let session: T | null = null;
  let lastSize = '';
  let disposed = false;

  const sendControl = (message: TerminalClientMessage) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };
  const sendInput = (data: string) => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(encoder.encode(data));
    if (data.includes('\r')) handlers.onCommandRun?.();
  };
  const sendResize = () => {
    try {
      fit.fit();
    } catch {
      return;
    }
    const size = `${terminal.cols}x${terminal.rows}`;
    if (size === lastSize || socket?.readyState !== WebSocket.OPEN) return;
    lastSize = size;
    sendControl({ type: 'resize', cols: terminal.cols, rows: terminal.rows });
  };

  try {
    fit.fit();
  } catch {
    terminal.resize(80, 24);
  }

  const resizeObserver = new ResizeObserver(sendResize);
  resizeObserver.observe(element);
  const themeObserver = new MutationObserver(() => {
    terminal.options.theme = themeFromTokens();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-skin'],
  });
  const inputSubscription = terminal.onData(sendInput);
  terminal.attachCustomKeyEventHandler((event) => {
    const sequence = lineEditingSequence(event);
    if (!sequence) return true;
    if (event.type === 'keydown') sendInput(sequence);
    return false;
  });

  const connect = (created: T) => {
    const ws = new WebSocket(streamUrl(created, terminal.cols, terminal.rows));
    ws.binaryType = 'arraybuffer';
    socket = ws;
    const { signal } = abort;
    ws.addEventListener(
      'open',
      () => {
        sendResize();
        handlers.onOpen(created);
        terminal.focus();
      },
      { signal },
    );
    ws.addEventListener(
      'message',
      (event: MessageEvent<ArrayBuffer | string>) => {
        if (event.data instanceof ArrayBuffer) {
          terminal.write(new Uint8Array(event.data));
          return;
        }
        const message = terminalServerMessageSchema.safeParse(JSON.parse(event.data));
        if (!message.success) return;
        if (message.data.type === 'hint') handlers.onHint?.(message.data.hint);
        if (message.data.type === 'ended') handlers.onEnded(message.data.reason);
      },
      { signal },
    );
    ws.addEventListener(
      'close',
      (event) => {
        if (event.code === 4401) handlers.onError(event.reason || 'The terminal could not start.');
      },
      { signal },
    );
  };

  void Promise.resolve()
    .then(() => (disposed ? null : start()))
    .then((created) => {
      if (!created) return;
      session = created;
      if (disposed) {
        void deleteTerminalSession(created.id);
        return;
      }
      connect(created);
    })
    .catch((error: unknown) => {
      if (!disposed) {
        handlers.onError(error instanceof Error ? error.message : 'The terminal could not start.');
      }
    });

  return {
    run: () => {
      sendInput('\r');
      terminal.focus();
    },
    notice: (text) => terminal.write(`\r\n\x1b[2m${text}\x1b[0m\r\n`),
    fit: sendResize,
    focus: () => {
      sendResize();
      terminal.focus();
    },
    close: () => sendControl({ type: 'close' }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      abort.abort();
      resizeObserver.disconnect();
      themeObserver.disconnect();
      inputSubscription.dispose();
      if (socket) socket.close();
      else if (session) void deleteTerminalSession(session.id);
      webgl?.dispose();
      terminal.dispose();
    },
  };
}

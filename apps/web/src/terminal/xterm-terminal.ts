import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import './xterm-terminal.css';
import { terminalServerMessageSchema, type TerminalClientMessage } from '@spark-outpost/contracts';
import { deleteTerminalSession, streamUrl, type TerminalTicket } from './terminal-api.ts';
import type { TerminalConnection, TerminalHandlers } from './terminal-connection.ts';
import { focusBeside } from './leave-terminal.ts';
import { terminalLinkFollower } from './link-pointer.ts';
import { followMouseReporting, MOUSE_REPORTING_OFF } from './mouse-reporting.ts';
import { refitWhenFontLoads, terminalFont, TERMINAL_FONT_SIZE } from './terminal-font.ts';
import { lineEditingSequence, tabAction } from './terminal-keys.ts';
import { openTerminalLink } from './terminal-links.ts';
import { colorsFromTokens, themeFromTokens } from './terminal-theme.ts';
import { followTerminalDrops } from './terminal-drop.ts';
import { followSelection, selectionActions } from './selection/follow-selection.ts';
import { createAckCounter } from './output-acks.ts';
import { followWebglRenderer } from './webgl-renderer.ts';

const OSC_CLIPBOARD = 52;
const RESIZE_SEND_MS = 90;
const encoder = new TextEncoder();

export function createTerminal(overrides: ITerminalOptions = {}): Terminal {
  return new Terminal({
    fontFamily: terminalFont(),
    fontSize: TERMINAL_FONT_SIZE,
    lineHeight: 1.25,
    cursorBlink: true,
    scrollback: 5000,
    minimumContrastRatio: 4.5,
    screenReaderMode: true,
    theme: themeFromTokens(),
    linkHandler: { activate: (event, uri) => openTerminalLink(event, uri) },
    macOptionClickForcesSelection: true,
    altClickMovesCursor: false,
    ...overrides,
  });
}

export function followTheme(terminal: Terminal, onChange?: () => void): () => void {
  const update = () => {
    terminal.options.theme = themeFromTokens();
    onChange?.();
  };
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-skin'],
  });
  const scheme =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
  scheme?.addEventListener('change', update);
  return () => {
    observer.disconnect();
    scheme?.removeEventListener('change', update);
  };
}

export function openXterm<T extends TerminalTicket>(
  start: () => Promise<T>,
  element: HTMLElement,
  handlers: TerminalHandlers<T>,
): TerminalConnection {
  const abort = new AbortController();
  const readOnly = handlers.readOnly === true;
  const links = handlers.onLink ? terminalLinkFollower(handlers.onLink) : null;
  const terminal = createTerminal({
    ...(readOnly ? { disableStdin: true, cursorBlink: false } : {}),
    ...(links ? { linkHandler: links.osc } : {}),
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.loadAddon(
    links
      ? new WebLinksAddon(links.activate, links.webLinks)
      : new WebLinksAddon((event, uri) => openTerminalLink(event, uri)),
  );
  terminal.open(element);
  const unfollowLinks = links?.follow(terminal, element);
  const unfollowWebgl = followWebglRenderer(terminal, element);
  terminal.parser.registerOscHandler(OSC_CLIPBOARD, () => true);

  let socket: WebSocket | null = null;
  let session: T | null = null;
  let lastSize = '';
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let ended = false;
  let disposed = false;

  const sendControl = (message: TerminalClientMessage) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };
  const sendInput = (data: string) => {
    if (readOnly || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(encoder.encode(data));
    if (data.includes('\r')) handlers.onCommandRun?.();
  };
  const sendColors = () => {
    const colors = colorsFromTokens();
    if (colors) sendControl({ type: 'colors', colors });
  };
  const fitToElement = () => {
    try {
      fit.fit();
      return true;
    } catch {
      return false;
    }
  };
  const sendSize = () => {
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    resizeTimer = null;
    const size = `${terminal.cols}x${terminal.rows}`;
    if (size === lastSize || socket?.readyState !== WebSocket.OPEN) return;
    lastSize = size;
    sendControl({ type: 'resize', cols: terminal.cols, rows: terminal.rows });
  };
  const sendResize = () => {
    if (fitToElement()) sendSize();
  };
  const resized = () => {
    if (!fitToElement()) return;
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(sendSize, RESIZE_SEND_MS);
  };
  const acknowledge = createAckCounter((bytes) => sendControl({ type: 'ack', bytes }));

  try {
    fit.fit();
  } catch {
    terminal.resize(80, 24);
  }

  const resizeObserver = new ResizeObserver(resized);
  resizeObserver.observe(element);
  const unfollowTheme = followTheme(terminal, sendColors);
  const inputSubscription = terminal.onData(sendInput);
  const dropped = (text: string) => {
    if (socket?.readyState !== WebSocket.OPEN)
      throw new Error('Reconnect the terminal before dropping files or folders.');
    terminal.paste(text);
    terminal.focus();
  };
  const unfollowDrops = readOnly
    ? () => undefined
    : followTerminalDrops(element, dropped, (message) => handlers.onInputError?.(message));
  const canInsert = () => !readOnly && !ended && socket?.readyState === WebSocket.OPEN;
  const selection = followSelection(terminal, element, canInsert, handlers.onSelection);
  const unfollowMouse = followMouseReporting(terminal, handlers.onMouseReporting);
  const unfollowFont = refitWhenFontLoads(terminal, sendResize);
  terminal.attachCustomKeyEventHandler((event) => {
    const tab = tabAction(event);
    if (tab && readOnly) return false;
    if (tab === 'leave') {
      if (event.type === 'keydown') {
        event.preventDefault();
        focusBeside(element, event.shiftKey);
      }
      return false;
    }
    if (tab === 'send') event.preventDefault();
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
        sendControl({ type: 'ack', bytes: 0 });
        sendResize();
        sendColors();
        selection.refresh();
        handlers.onOpen(created);
        if (!readOnly) terminal.focus();
      },
      { signal },
    );
    ws.addEventListener(
      'message',
      (event: MessageEvent<ArrayBuffer | string>) => {
        if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data);
          terminal.write(bytes, () => acknowledge(bytes.byteLength));
          return;
        }
        const message = terminalServerMessageSchema.safeParse(JSON.parse(event.data));
        if (!message.success) return;
        if (message.data.type === 'hint') handlers.onHint?.(message.data.hint);
        if (message.data.type === 'ended') {
          ended = true;
          terminal.write(MOUSE_REPORTING_OFF);
          selection.refresh();
          handlers.onEnded(message.data.reason);
        }
      },
      { signal },
    );
    ws.addEventListener(
      'close',
      (event) => {
        selection.refresh();
        handlers.onDisconnected?.();
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
        if (!handlers.preserveSession) void deleteTerminalSession(created.id);
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
    ...selectionActions(terminal, canInsert),
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
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      unfollowTheme();
      unfollowDrops();
      selection.stop();
      unfollowMouse();
      unfollowFont();
      unfollowLinks?.();
      inputSubscription.dispose();
      if (socket) socket.close();
      else if (session && !handlers.preserveSession) void deleteTerminalSession(session.id);
      unfollowWebgl();
      terminal.dispose();
    },
  };
}

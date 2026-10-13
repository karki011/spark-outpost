import type { ILinkHandler, Terminal } from '@xterm/xterm';

export interface LinkPoint {
  x: number;
  y: number;
}

export interface LinkOpener {
  open(uri: string, wanted: 'pane' | 'browser'): void;
  menu(uri: string, point: LinkPoint): boolean;
}

export interface PointerFacts {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export type LinkPress = 'pane' | 'browser' | 'menu' | 'pass';

export function linkPress(event: PointerFacts, onLink: boolean): LinkPress {
  if (!onLink || event.altKey || event.shiftKey) return 'pass';
  if (event.button === 2) return 'menu';
  if (event.button !== 0 || event.ctrlKey) return 'pass';
  return event.metaKey ? 'browser' : 'pane';
}

type ModesTerminal = Pick<Terminal, 'modes' | 'focus'>;

export function terminalLinkFollower(opener: LinkOpener) {
  let hovered: string | null = null;
  const hover = (_event: MouseEvent, uri: string) => {
    hovered = uri;
  };
  const leave = () => {
    hovered = null;
  };
  const activate = (event: MouseEvent, uri: string) => {
    event.preventDefault();
    const press = linkPress(event, true);
    if (press === 'pane' || press === 'browser') opener.open(uri, press);
  };
  const osc: ILinkHandler = { activate, hover, leave, allowNonHttpProtocols: true };
  return {
    osc,
    activate,
    webLinks: { hover, leave },
    follow(terminal: ModesTerminal, element: HTMLElement): () => void {
      const screen = element.querySelector<HTMLElement>('.xterm-screen');
      if (!screen) return () => undefined;
      const abort = new AbortController();
      const reporting = () => terminal.modes.mouseTrackingMode !== 'none';
      const onDown = (event: MouseEvent) => {
        if (linkPress(event, hovered !== null) === 'pass' || !reporting()) return;
        event.stopPropagation();
        event.preventDefault();
        terminal.focus();
      };
      const onMenu = (event: MouseEvent) => {
        if (hovered === null || event.altKey || event.shiftKey) return;
        if (!opener.menu(hovered, { x: event.clientX, y: event.clientY })) return;
        event.preventDefault();
        event.stopPropagation();
      };
      screen.addEventListener('mousedown', onDown, { signal: abort.signal });
      screen.addEventListener('contextmenu', onMenu, { signal: abort.signal });
      return () => abort.abort();
    },
  };
}

import { defaultBrowserUrl, paneUrl } from '../browser/chat-links.ts';
import { outsideTarget } from '../browser/outside-link.ts';

export type OpenWindow = (url: string, target: string, features: string) => unknown;

export function openTerminalLink(
  event: Pick<MouseEvent, 'preventDefault'>,
  uri: string,
  open: OpenWindow = (url, target, features) => window.open(url, target, features),
): boolean {
  event.preventDefault();
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  open(url.href, outsideTarget(), 'noopener,noreferrer');
  return true;
}

export interface LinkRoot {
  id: string;
  rootPath: string;
}

export interface LinkPlace {
  pane: boolean;
  appOrigin: string;
  roots: readonly LinkRoot[];
}

export type TerminalLinkTarget =
  | { open: 'pane'; url: string }
  | { open: 'browser'; url: string }
  | { open: 'file'; projectId: string; path: string };

function fileTarget(uri: string, roots: readonly LinkRoot[]): TerminalLinkTarget | null {
  let path: string;
  try {
    const url = new URL(uri);
    if (url.protocol !== 'file:') return null;
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (path.split('/').includes('..')) return null;
  for (const root of roots) {
    const prefix = root.rootPath.endsWith('/') ? root.rootPath : `${root.rootPath}/`;
    if (path.startsWith(prefix) && path.length > prefix.length)
      return { open: 'file', projectId: root.id, path: path.slice(prefix.length) };
  }
  return null;
}

export function terminalLinkTarget(
  uri: string,
  place: LinkPlace,
  wanted: 'pane' | 'browser',
): TerminalLinkTarget | null {
  const url = paneUrl(uri);
  if (!url) return fileTarget(uri, place.roots);
  if (wanted === 'pane' && place.pane) return { open: 'pane', url };
  const outside = defaultBrowserUrl(url, place.appOrigin);
  return outside ? { open: 'browser', url: outside } : null;
}

export function menuLinkUrl(uri: string): string | null {
  return paneUrl(uri);
}

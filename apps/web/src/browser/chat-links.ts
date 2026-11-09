import {
  BROWSER_TABS_MAX,
  classifyBrowserUrl,
  parseBrowserUrl,
  type BrowserCommand,
  type BrowserPaneTab,
} from '@spark-outpost/contracts';
import { desktopBrowser } from '../desktop/desktop-bridge.ts';
import { knownTabs, sendBrowserCommand } from './browser-store.ts';
import { setBrowserPaneOpen } from './pane-open.ts';
import { hiddenPlacement, type BrowserHome } from './use-view-placement.ts';
import { openOutside } from './outside-link.ts';

const CHAT_LINKS_ATTRIBUTE = 'data-chat-links';

const WEB_LINK = /^https?:\/\//i;

export interface ClickFacts {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

export interface LinkFacts {
  href: string | null;
  inChat: boolean;
  download: boolean;
}

export type LinkAction = { open: 'pane'; url: string } | { open: 'native' };

const NATIVE: LinkAction = { open: 'native' };

export function paneUrl(href: string | null): string | null {
  const typed = href?.trim() ?? '';
  if (!WEB_LINK.test(typed)) return null;
  const kind = classifyBrowserUrl(typed);
  if (kind !== 'local' && kind !== 'external') return null;
  return parseBrowserUrl(typed)?.href ?? null;
}

export function defaultBrowserUrl(href: string | null, appOrigin: string): string | null {
  const url = paneUrl(href);
  return url && parseBrowserUrl(url)?.origin !== appOrigin ? url : null;
}

export function isPlainClick(click: ClickFacts): boolean {
  if (click.defaultPrevented || click.button !== 0) return false;
  return !(click.metaKey || click.ctrlKey || click.shiftKey || click.altKey);
}

export function paneTarget(link: LinkFacts, paneAvailable: boolean): string | null {
  if (!paneAvailable || !link.inChat || link.download) return null;
  return paneUrl(link.href);
}

export function linkAction(click: ClickFacts, link: LinkFacts, paneAvailable: boolean): LinkAction {
  if (!isPlainClick(click)) return NATIVE;
  const url = paneTarget(link, paneAvailable);
  return url ? { open: 'pane', url } : NATIVE;
}

export function paneCommands(url: string, tabs: readonly BrowserPaneTab[]): BrowserCommand[] {
  const showing = tabs.find((tab) => tab.url === url);
  if (showing) return [{ command: 'select', tabId: showing.id }];
  const active = tabs.find((tab) => tab.active) ?? null;
  if (active && active.url === '' && active.error === null && !active.loading) {
    return [
      { command: 'close', tabId: active.id },
      { command: 'new_tab', url },
    ];
  }
  if (active && tabs.length >= BROWSER_TABS_MAX) {
    return [{ command: 'navigate', tabId: active.id, url }];
  }
  return [{ command: 'new_tab', url }];
}

function insideChat(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${CHAT_LINKS_ATTRIBUTE}]`) !== null;
}

export function linkFacts(anchor: HTMLAnchorElement): LinkFacts {
  return {
    href: anchor.getAttribute('href'),
    inChat: insideChat(anchor),
    download: anchor.hasAttribute('download'),
  };
}

export function anchorOf(target: EventTarget | null): HTMLAnchorElement | null {
  return target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
}

async function tabsOf(home: BrowserHome): Promise<readonly BrowserPaneTab[]> {
  const known = knownTabs(home.chatId);
  if (known.length > 0) return known;
  const started = await desktopBrowser()?.start(hiddenPlacement(home));
  return started?.tabs ?? [];
}

export async function openInPane(home: BrowserHome, url: string): Promise<void> {
  const tabs = await tabsOf(home);
  for (const command of paneCommands(url, tabs)) sendBrowserCommand(home.chatId, command);
  setBrowserPaneOpen(home.chatId, true);
}

export function openInDefaultBrowser(href: string): void {
  const url = defaultBrowserUrl(href, window.location.origin);
  if (url) openOutside(url);
}

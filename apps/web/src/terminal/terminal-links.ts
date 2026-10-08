import { openChatLink, type ClickFacts } from '../browser/chat-links.ts';

export type OpenWindow = (url: string, target: string, features: string) => unknown;
export type OpenInChat = (url: string, click: ClickFacts, target: EventTarget | null) => boolean;
export type TerminalClick = Pick<MouseEvent, 'preventDefault' | 'target'> & ClickFacts;

export function openTerminalLink(
  event: TerminalClick,
  uri: string,
  open: OpenWindow = (url, target, features) => window.open(url, target, features),
  openInChat: OpenInChat = openChatLink,
): boolean {
  const click: ClickFacts = {
    button: event.button,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    defaultPrevented: false,
  };
  event.preventDefault();
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (openInChat(url.href, click, event.target)) return true;
  open(url.href, '_blank', 'noopener,noreferrer');
  return true;
}

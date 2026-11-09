import { useEffect, useState } from 'react';
import { useLinksIn } from '../browser-view/links-in.ts';
import { usePaneFocused } from '../chat/split/chat-pane.ts';
import { anchorFor } from '../conversations/menu-anchor.ts';
import { useStableCallback } from '../ui/use-stable-callback.ts';
import { anchorOf, linkAction, linkFacts, openInPane, paneTarget } from './chat-links.ts';
import { LinkMenu, type OpenLinkMenu } from './LinkMenu.tsx';
import { onPaneUrl, takePaneUrl } from './pending-pane-url.ts';
import type { BrowserHome } from './use-view-placement.ts';

export function ChatLinks({ home }: { home: BrowserHome }) {
  const [menu, setMenu] = useState<OpenLinkMenu | null>(null);
  const open = useStableCallback((url: string) => void openInPane(home, url));
  const focused = usePaneFocused();
  const clicksToPane = useLinksIn() !== 'browser';

  useEffect(() => {
    const takePending = () => {
      const url = takePaneUrl(home.chatId);
      if (url) open(url);
    };
    takePending();
    return onPaneUrl(takePending);
  }, [home.chatId, open]);

  useEffect(() => {
    if (!focused) return;
    const onClick = (event: MouseEvent) => {
      const anchor = anchorOf(event.target);
      if (!anchor) return;
      const action = linkAction(event, linkFacts(anchor), clicksToPane);
      if (action.open !== 'pane') return;
      event.preventDefault();
      open(action.url);
    };
    const onContextMenu = (event: MouseEvent) => {
      const anchor = anchorOf(event.target);
      const url = anchor && !event.defaultPrevented ? paneTarget(linkFacts(anchor), true) : null;
      if (!anchor || !url) return;
      event.preventDefault();
      const point = event.button === 2 ? { x: event.clientX, y: event.clientY } : null;
      setMenu({ url, anchor: anchorFor(anchor, point) });
    };
    document.addEventListener('click', onClick);
    document.addEventListener('contextmenu', onContextMenu);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('contextmenu', onContextMenu);
    };
  }, [open, focused, clicksToPane]);

  if (!menu) return null;
  return <LinkMenu menu={menu} openInPane={open} onClose={() => setMenu(null)} />;
}

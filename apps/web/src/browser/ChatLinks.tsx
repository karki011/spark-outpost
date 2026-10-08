import '../conversations/chat-menu.css';
import { useEffect, useState } from 'react';
import { anchorFor } from '../conversations/menu-anchor.ts';
import { MenuItem, MenuShell, type MenuAnchor } from '../conversations/MenuShell.tsx';
import { CopyIcon, ExternalLinkIcon } from '../ui/icons.tsx';
import { useStableCallback } from '../ui/use-stable-callback.ts';
import { GlobeIcon } from './BrowserIcons.tsx';
import {
  anchorOf,
  defaultBrowserUrl,
  linkAction,
  linkFacts,
  openInDefaultBrowser,
  openInPane,
  paneTarget,
} from './chat-links.ts';
import type { BrowserHome } from './use-view-placement.ts';

interface OpenLinkMenu {
  url: string;
  anchor: MenuAnchor;
}

export function ChatLinks({ home }: { home: BrowserHome }) {
  const [menu, setMenu] = useState<OpenLinkMenu | null>(null);
  const open = useStableCallback((url: string) => void openInPane(home, url));

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const anchor = anchorOf(event.target);
      if (!anchor) return;
      const action = linkAction(event, linkFacts(anchor), true);
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
  }, [open]);

  if (!menu) return null;
  const close = () => {
    setMenu(null);
    menu.anchor.focusBack?.focus();
  };
  const run = (action: (url: string) => void) => () => {
    close();
    action(menu.url);
  };
  return (
    <MenuShell anchor={menu.anchor} label="Link options" page="main" onClose={close}>
      <MenuItem icon={<GlobeIcon />} label="Open in Spark browser" onSelect={run(open)} />
      <MenuItem
        icon={<ExternalLinkIcon />}
        label="Open in default browser"
        disabled={defaultBrowserUrl(menu.url, window.location.origin) === null}
        onSelect={run(openInDefaultBrowser)}
      />
      <MenuItem
        icon={<CopyIcon />}
        label="Copy link"
        onSelect={run((url) => void navigator.clipboard.writeText(url).catch(() => undefined))}
      />
    </MenuShell>
  );
}

import '../conversations/chat-menu.css';
import { MenuItem, MenuShell, type MenuAnchor } from '../conversations/MenuShell.tsx';
import { CopyIcon, ExternalLinkIcon } from '../ui/icons.tsx';
import { GlobeIcon } from './BrowserIcons.tsx';
import { defaultBrowserUrl, openInDefaultBrowser } from './chat-links.ts';

export interface OpenLinkMenu {
  url: string;
  anchor: MenuAnchor;
}

interface LinkMenuProps {
  menu: OpenLinkMenu;
  openInPane: ((url: string) => void) | null;
  onClose: () => void;
}

export function LinkMenu({ menu, openInPane, onClose }: LinkMenuProps) {
  const close = () => {
    onClose();
    menu.anchor.focusBack?.focus();
  };
  const run = (action: (url: string) => void) => () => {
    close();
    action(menu.url);
  };
  return (
    <MenuShell anchor={menu.anchor} label="Link options" page="main" onClose={close}>
      {openInPane && (
        <MenuItem icon={<GlobeIcon />} label="Open in Spark browser" onSelect={run(openInPane)} />
      )}
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

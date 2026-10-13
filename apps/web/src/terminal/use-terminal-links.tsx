import { useMemo, useState, type ReactNode } from 'react';
import { openInDefaultBrowser, openInPane } from '../browser/chat-links.ts';
import { LinkMenu, type OpenLinkMenu } from '../browser/LinkMenu.tsx';
import type { BrowserHome } from '../browser/use-view-placement.ts';
import { useOpenFile } from '../chat/project/file-sheet/FileSheet.tsx';
import { useStableCallback } from '../ui/use-stable-callback.ts';
import type { LinkOpener } from './link-pointer.ts';
import { menuLinkUrl, terminalLinkTarget, type LinkRoot } from './terminal-links.ts';

export function useTerminalLinks(
  home: BrowserHome | null,
  roots: readonly LinkRoot[],
): { opener: LinkOpener; menu: ReactNode } {
  const [menu, setMenu] = useState<OpenLinkMenu | null>(null);
  const openFile = useOpenFile();
  const toPane = useStableCallback((url: string) => {
    if (home) void openInPane(home, url);
  });
  const open = useStableCallback((uri: string, wanted: 'pane' | 'browser') => {
    const place = { pane: home !== null, appOrigin: window.location.origin, roots };
    const target = terminalLinkTarget(uri, place, wanted);
    if (target?.open === 'pane') toPane(target.url);
    if (target?.open === 'browser') openInDefaultBrowser(target.url);
    if (target?.open === 'file') openFile?.(target.projectId, target.path);
  });
  const showMenu = useStableCallback((uri: string, point: { x: number; y: number }) => {
    const url = menuLinkUrl(uri);
    if (!url) return false;
    const focusBack = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMenu({ url, anchor: { x: point.x, y: point.y + 4, above: point.y - 4, focusBack } });
    return true;
  });
  const opener = useMemo<LinkOpener>(() => ({ open, menu: showMenu }), [open, showMenu]);
  return {
    opener,
    menu: menu && (
      <LinkMenu menu={menu} openInPane={home ? toPane : null} onClose={() => setMenu(null)} />
    ),
  };
}

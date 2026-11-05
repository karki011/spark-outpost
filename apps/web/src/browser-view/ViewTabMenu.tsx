import '../conversations/chat-menu.css';
import { useRef, useState } from 'react';
import {
  wanderedFromPinned,
  type BrowserPaneTab,
  type BrowserProfile,
  type BrowserViewLayout,
} from '@spark-outpost/contracts';
import { NavBackIcon } from '../browser/BrowserIcons.tsx';
import { tabLabel } from '../browser/tab-label.ts';
import { MenuItem, MenuShell, type MenuAnchor } from '../conversations/MenuShell.tsx';
import { DotsIcon, FolderIcon, MoveIcon, PlusIcon } from '../ui/icons.tsx';
import { placeOf } from './spaces-model.ts';
import { sendViewCommand } from './view-store.ts';

interface ViewTabActionsProps {
  profile: BrowserProfile;
  tab: BrowserPaneTab;
  layout: BrowserViewLayout;
  onNewFolder?: (tabId: string) => void;
}

function pinnedHome(profile: BrowserProfile, tabId: string) {
  sendViewCommand(profile, { command: 'pinned_home', tabId });
}

export function ViewTabActions({ profile, tab, layout, onNewFolder }: ViewTabActionsProps) {
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const place = placeOf(layout, tab.id);
  const title = tabLabel(tab);
  const wandered = tab.pinned && wanderedFromPinned(tab.url, place?.pinnedUrl ?? null);
  const otherSpaces = layout.spaces.filter((space) => space.id !== place?.spaceId);
  const folders = tab.pinned
    ? layout.folders.filter(
        (folder) => folder.spaceId === place?.spaceId && folder.id !== place.folderId,
      )
    : [];
  const open = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({ x: rect.left, y: rect.bottom + 4, above: rect.top - 4, focusBack: button.current });
  };
  const close = () => {
    setAnchor(null);
    button.current?.focus();
  };
  const run = (work: () => void) => {
    setAnchor(null);
    work();
  };
  const hasItems = otherSpaces.length > 0 || tab.pinned;
  return (
    <>
      {wandered && (
        <button
          type="button"
          className="icon-btn bv-tab-act bv-tab-home"
          aria-label={`Back to pinned address: ${title}`}
          title={`Back to pinned address: ${place?.pinnedUrl ?? ''}`}
          onClick={() => pinnedHome(profile, tab.id)}
        >
          <NavBackIcon />
        </button>
      )}
      {hasItems && (
        <button
          ref={button}
          type="button"
          className="icon-btn bv-tab-x"
          aria-label={`More for ${title}`}
          aria-haspopup="menu"
          aria-expanded={anchor !== null}
          onClick={() => (anchor ? close() : open())}
        >
          <DotsIcon />
        </button>
      )}
      {anchor && (
        <MenuShell anchor={anchor} label={`More for ${title}`} page="main" onClose={close}>
          {wandered && (
            <MenuItem
              icon={<NavBackIcon />}
              label="Back to pinned address"
              onSelect={() => run(() => pinnedHome(profile, tab.id))}
            />
          )}
          {folders.map((folder) => (
            <MenuItem
              key={folder.id}
              icon={<FolderIcon />}
              label={`Move to folder ${folder.name}`}
              onSelect={() =>
                run(() =>
                  sendViewCommand(profile, {
                    command: 'tab_to_folder',
                    tabId: tab.id,
                    folderId: folder.id,
                  }),
                )
              }
            />
          ))}
          {tab.pinned && onNewFolder && (
            <MenuItem
              icon={<PlusIcon />}
              label="New folder with this tab…"
              onSelect={() => run(() => onNewFolder(tab.id))}
            />
          )}
          {tab.pinned && place?.folderId && (
            <MenuItem
              icon={<FolderIcon />}
              label="Take out of folder"
              onSelect={() =>
                run(() =>
                  sendViewCommand(profile, {
                    command: 'tab_to_folder',
                    tabId: tab.id,
                    folderId: null,
                  }),
                )
              }
            />
          )}
          {otherSpaces.map((space) => (
            <MenuItem
              key={space.id}
              icon={<MoveIcon />}
              label={`Move to Space ${space.name}`}
              onSelect={() =>
                run(() =>
                  sendViewCommand(profile, {
                    command: 'tab_to_space',
                    tabId: tab.id,
                    spaceId: space.id,
                  }),
                )
              }
            />
          ))}
        </MenuShell>
      )}
    </>
  );
}

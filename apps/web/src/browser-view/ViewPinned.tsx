import { useRef, useState, type DragEvent } from 'react';
import type {
  BrowserPaneTab,
  BrowserProfile,
  BrowserTabFolder,
  BrowserViewLayout,
  BrowserViewSplit,
} from '@spark-outpost/contracts';
import { MenuItem, MenuShell, type MenuAnchor } from '../conversations/MenuShell.tsx';
import { ChevronIcon, DotsIcon, FolderIcon, PlusIcon } from '../ui/icons.tsx';
import { NameForm } from './NameForm.tsx';
import { pinnedGroups } from './spaces-model.ts';
import { TabList } from './ViewTabs.tsx';
import { ViewTabActions } from './ViewTabMenu.tsx';
import { sendViewCommand } from './view-store.ts';

const TAB_DRAG_TYPE = 'application/x-spark-pinned-tab';

interface ViewPinnedProps {
  profile: BrowserProfile;
  tabs: readonly BrowserPaneTab[];
  layout: BrowserViewLayout;
  split: BrowserViewSplit | null;
}

function useDropTab(profile: BrowserProfile, folderId: string | null) {
  const [over, setOver] = useState(false);
  const accepts = (event: DragEvent) => event.dataTransfer.types.includes(TAB_DRAG_TYPE);
  return {
    over,
    props: {
      onDragOver: (event: DragEvent) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (event: DragEvent) => {
        setOver(false);
        const tabId = event.dataTransfer.getData(TAB_DRAG_TYPE);
        if (tabId === '') return;
        event.preventDefault();
        sendViewCommand(profile, { command: 'tab_to_folder', tabId, folderId });
      },
    },
  };
}

function FolderMenu({
  folder,
  onRename,
  onDelete,
}: {
  folder: BrowserTabFolder;
  onRename(): void;
  onDelete(): void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const close = () => {
    setAnchor(null);
    button.current?.focus();
  };
  const open = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({ x: rect.left, y: rect.bottom + 4, above: rect.top - 4, focusBack: button.current });
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className="icon-btn bv-tab-act"
        aria-label={`More for folder ${folder.name}`}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={() => (anchor ? close() : open())}
      >
        <DotsIcon />
      </button>
      {anchor && (
        <MenuShell
          anchor={anchor}
          label={`More for folder ${folder.name}`}
          page="main"
          onClose={close}
        >
          <MenuItem
            label="Rename folder…"
            onSelect={() => {
              setAnchor(null);
              onRename();
            }}
          />
          <MenuItem
            label="Delete folder (tabs stay pinned)"
            onSelect={() => {
              setAnchor(null);
              onDelete();
            }}
          />
        </MenuShell>
      )}
    </>
  );
}

function FolderGroup({
  profile,
  folder,
  tabs,
  split,
  rowExtras,
  rowProps,
}: {
  profile: BrowserProfile;
  folder: BrowserTabFolder;
  tabs: readonly BrowserPaneTab[];
  split: BrowserViewSplit | null;
  rowExtras(tab: BrowserPaneTab): React.ReactNode;
  rowProps(tab: BrowserPaneTab): React.LiHTMLAttributes<HTMLLIElement>;
}) {
  const [renaming, setRenaming] = useState(false);
  const drop = useDropTab(profile, folder.id);
  if (renaming) {
    return (
      <NameForm
        label="Folder name"
        start={folder.name}
        onCancel={() => setRenaming(false)}
        onSave={(name) => {
          setRenaming(false);
          sendViewCommand(profile, { command: 'folder_rename', id: folder.id, name });
        }}
      />
    );
  }
  return (
    <div className="bv-folder">
      <div className={drop.over ? 'bv-folder-head over' : 'bv-folder-head'} {...drop.props}>
        <button
          type="button"
          className="bv-row bv-folder-toggle"
          aria-expanded={!folder.collapsed}
          onClick={() =>
            sendViewCommand(profile, {
              command: 'folder_collapse',
              id: folder.id,
              collapsed: !folder.collapsed,
            })
          }
        >
          <span className={folder.collapsed ? 'bv-folder-chev shut' : 'bv-folder-chev'}>
            <ChevronIcon />
          </span>
          <FolderIcon />
          <span className="bv-tab-title">{folder.name}</span>
          <span className="bv-folder-count">{tabs.length}</span>
        </button>
        <FolderMenu
          folder={folder}
          onRename={() => setRenaming(true)}
          onDelete={() => sendViewCommand(profile, { command: 'folder_delete', id: folder.id })}
        />
      </div>
      {!folder.collapsed && (
        <TabList
          profile={profile}
          tabs={tabs}
          split={split}
          label={`Tabs in ${folder.name}`}
          rowExtras={rowExtras}
          rowProps={rowProps}
        />
      )}
    </div>
  );
}

export function ViewPinned({ profile, tabs, layout, split }: ViewPinnedProps) {
  const [naming, setNaming] = useState<{ tabId: string | null } | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const looseDrop = useDropTab(profile, null);
  const groups = pinnedGroups(tabs, layout);
  if (tabs.every((tab) => !tab.pinned) && groups.folders.length === 0 && !naming) return null;
  const rowExtras = (tab: BrowserPaneTab) => (
    <ViewTabActions
      profile={profile}
      tab={tab}
      layout={layout}
      onNewFolder={(tabId) => setNaming({ tabId })}
    />
  );
  const rowProps = (tab: BrowserPaneTab) => ({
    draggable: true,
    onDragStart: (event: DragEvent<HTMLLIElement>) => {
      event.dataTransfer.setData(TAB_DRAG_TYPE, tab.id);
      event.dataTransfer.effectAllowed = 'move';
    },
  });
  const finishNaming = () => {
    setNaming(null);
    requestAnimationFrame(() => addButton.current?.focus());
  };
  return (
    <section className="bv-section" aria-labelledby="bv-pinned">
      <div
        className={looseDrop.over ? 'bv-pinned-head over' : 'bv-pinned-head'}
        {...looseDrop.props}
      >
        <h2 id="bv-pinned" className="bv-heading">
          Pinned
        </h2>
        <button
          ref={addButton}
          type="button"
          className="icon-btn bv-tab-act"
          aria-label="New folder"
          title="New folder"
          onClick={() => setNaming({ tabId: null })}
        >
          <PlusIcon />
        </button>
      </div>
      {naming && (
        <NameForm
          label="Folder name"
          start=""
          onCancel={finishNaming}
          onSave={(name) => {
            sendViewCommand(profile, { command: 'folder_create', name, tabId: naming.tabId });
            finishNaming();
          }}
        />
      )}
      {groups.folders.map(({ folder, tabs: inFolder }) => (
        <FolderGroup
          key={folder.id}
          profile={profile}
          folder={folder}
          tabs={inFolder}
          split={split}
          rowExtras={rowExtras}
          rowProps={rowProps}
        />
      ))}
      <TabList
        profile={profile}
        tabs={groups.loose}
        split={split}
        label="Pinned tabs"
        rowExtras={rowExtras}
        rowProps={rowProps}
      />
    </section>
  );
}

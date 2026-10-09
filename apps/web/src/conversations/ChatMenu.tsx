import { useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ConversationSummary, Outpost, Project } from '@spark-outpost/contracts';
import {
  ArchiveIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  BackIcon,
  ChevronIcon,
  CopyIcon,
  FolderIcon,
  MoveIcon,
  PenIcon,
  PinIcon,
  RestoreIcon,
  SparkleIcon,
  TrashIcon,
  UnpinIcon,
} from '../ui/icons.tsx';
import {
  AddToOutpostItem,
  HandlePick,
  OutpostPick,
  type AddToOutpostActions,
} from './AddToOutpost.tsx';
import { MenuItem as Item, MenuShell, type MenuAnchor } from './MenuShell.tsx';

type Page = 'main' | 'move' | 'outposts' | 'handle';

const BACK_FROM: Record<Exclude<Page, 'main'>, Page> = {
  move: 'main',
  outposts: 'main',
  handle: 'outposts',
};

export interface ChatMenuActions {
  onRename: () => void;
  onAutoTitle: (on: boolean) => void;
  onPin: () => void;
  onCopyLink: () => void;
  onMove: (projectId: string | null) => void;
  onArchive: (archived: boolean) => void;
  onDelete: () => void;
}

interface ChatMenuProps extends ChatMenuActions {
  onMoveUp?: (() => void) | null;
  onMoveDown?: (() => void) | null;
  chat: ConversationSummary;
  anchor: MenuAnchor;
  projects: readonly Project[];
  outposts?: AddToOutpostActions | undefined;
  onClose: () => void;
}

export function ChatMenu({
  chat,
  anchor,
  projects,
  outposts,
  onClose,
  onMoveUp,
  onMoveDown,
  ...actions
}: ChatMenuProps) {
  const [page, setPage] = useState<Page>('main');
  const [target, setTarget] = useState<Outpost | null>(null);
  const [confirming, setConfirming] = useState(false);
  const archived = chat.archivedAt !== null;
  const primary = chat.projectIds[0] ?? null;
  const canJoin = !archived && !chat.outpost && chat.sessionType !== 'terminal';
  const joining = canJoin ? outposts : undefined;
  const handleSource = projects.find((project) => project.id === primary)?.name ?? chat.title;
  const autoTitles = chat.titleSource !== 'user';

  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (page !== 'main' && (event.key === 'Escape' || event.key === 'ArrowLeft')) {
      event.preventDefault();
      event.stopPropagation();
      setPage(BACK_FROM[page]);
      return true;
    }
    const submenu = (document.activeElement as HTMLElement | null)?.dataset.submenu;
    if (event.key === 'ArrowRight' && page === 'main' && submenu !== undefined) {
      event.preventDefault();
      setPage(submenu === 'outposts' ? 'outposts' : 'move');
      return true;
    }
    return false;
  };

  const mainItems = (
    <>
      <Item icon={<PenIcon />} label="Rename" onSelect={run(actions.onRename)} />
      <Item
        icon={<SparkleIcon />}
        label={autoTitles ? 'Stop auto-renaming this chat' : 'Resume auto titles'}
        onSelect={run(() => actions.onAutoTitle(!autoTitles))}
      />
      <Item
        icon={chat.pinnedAt ? <UnpinIcon /> : <PinIcon />}
        label={chat.pinnedAt ? 'Unpin' : 'Pin'}
        onSelect={run(actions.onPin)}
      />
      {onMoveUp !== undefined && (
        <>
          <Item
            icon={<ArrowUpIcon />}
            label="Move up"
            disabled={!onMoveUp}
            onSelect={run(() => onMoveUp?.())}
          />
          <Item
            icon={<ArrowDownIcon />}
            label="Move down"
            disabled={!onMoveDown}
            onSelect={run(() => onMoveDown?.())}
          />
        </>
      )}
      {joining && <AddToOutpostItem onOpen={() => setPage('outposts')} />}
      {!archived && (
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          data-submenu=""
          onClick={() => setPage('move')}
        >
          <MoveIcon />
          <span>Move to project</span>
          <span className="sub-chev">
            <ChevronIcon />
          </span>
        </button>
      )}
      <Item icon={<CopyIcon />} label="Copy chat link" onSelect={run(actions.onCopyLink)} />
      <hr />
      {archived ? (
        <Item
          icon={<RestoreIcon />}
          label="Unarchive"
          onSelect={run(() => actions.onArchive(false))}
        />
      ) : (
        <Item
          icon={<ArchiveIcon />}
          label="Archive"
          onSelect={run(() => actions.onArchive(true))}
        />
      )}
      <Item
        icon={<TrashIcon />}
        label={confirming ? 'Confirm delete' : 'Delete'}
        danger
        onSelect={confirming ? run(actions.onDelete) : () => setConfirming(true)}
      />
    </>
  );

  const moveItems = (
    <>
      <button type="button" role="menuitem" className="back" onClick={() => setPage('main')}>
        <BackIcon />
        <span>Move to project</span>
      </button>
      <hr />
      {projects.length === 0 && <p className="lab">No projects yet. Add one with the + button.</p>}
      {projects.map((project) => (
        <Item
          key={project.id}
          icon={<FolderIcon />}
          label={project.name}
          checked={project.id === primary}
          onSelect={run(() => actions.onMove(project.id))}
        />
      ))}
      <Item
        icon={<MoveIcon />}
        label="No project"
        checked={primary === null}
        onSelect={run(() => actions.onMove(null))}
      />
    </>
  );

  const outpostItems = joining && (
    <OutpostPick
      list={joining.list}
      onBack={() => setPage('main')}
      onPick={(outpost) => {
        setTarget(outpost);
        setPage('handle');
      }}
      onNew={run(joining.onNew)}
    />
  );

  const handleItems = joining && target && (
    <HandlePick
      outpost={target}
      suggestFrom={handleSource}
      onBack={() => setPage('outposts')}
      onAdd={(handle) => run(() => joining.onAdd(target.id, handle))()}
    />
  );

  const labels: Record<Page, string> = {
    main: `Options for ${chat.title}`,
    move: 'Move to project',
    outposts: 'Add to outpost',
    handle: target ? `Add to ${target.name}` : 'Add to outpost',
  };
  const pages: Record<Page, ReactNode> = {
    main: mainItems,
    move: moveItems,
    outposts: outpostItems,
    handle: handleItems,
  };

  return (
    <MenuShell anchor={anchor} label={labels[page]} page={page} onClose={onClose} onKey={onKey}>
      {pages[page]}
    </MenuShell>
  );
}

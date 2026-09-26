import { useState, type KeyboardEvent } from 'react';
import type { ConversationSummary, Project } from '@spark-outpost/contracts';
import {
  ArchiveIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  BackIcon,
  ChevronIcon,
  FolderIcon,
  MoveIcon,
  PenIcon,
  PinIcon,
  RestoreIcon,
  SparkleIcon,
  TrashIcon,
  UnpinIcon,
} from '../ui/icons.tsx';
import { MenuItem as Item, MenuShell, type MenuAnchor } from './MenuShell.tsx';
import { isRunning } from './row-state.ts';

export interface ChatMenuActions {
  onRename: () => void;
  onAutoTitle: (on: boolean) => void;
  onPin: () => void;
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
  onClose: () => void;
}

export function ChatMenu({
  chat,
  anchor,
  projects,
  onClose,
  onMoveUp,
  onMoveDown,
  ...actions
}: ChatMenuProps) {
  const [page, setPage] = useState<'main' | 'move'>('main');
  const [confirming, setConfirming] = useState(false);
  const archived = chat.archivedAt !== null;
  const primary = chat.projectIds[0] ?? null;
  const running = isRunning(chat);
  const autoTitles = chat.titleSource !== 'user';

  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (page === 'move' && (event.key === 'Escape' || event.key === 'ArrowLeft')) {
      event.preventDefault();
      event.stopPropagation();
      setPage('main');
      return true;
    }
    const focused = document.activeElement as HTMLElement | null;
    if (event.key === 'ArrowRight' && page === 'main' && focused?.dataset.submenu !== undefined) {
      event.preventDefault();
      setPage('move');
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
        disabled={running}
        title={running ? 'Stop the reply first' : undefined}
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

  return (
    <MenuShell
      anchor={anchor}
      label={page === 'main' ? `Options for ${chat.title}` : 'Move to project'}
      page={page}
      onClose={onClose}
      onKey={onKey}
    >
      {page === 'main' ? mainItems : moveItems}
    </MenuShell>
  );
}

import { useState } from 'react';
import type { Project } from '@spark-outpost/contracts';
import { PenIcon, PlusIcon, TrashIcon } from '../ui/icons.tsx';
import { MenuItem, MenuShell, type MenuAnchor } from './MenuShell.tsx';

interface ProjectMenuProps {
  project: Project;
  anchor: MenuAnchor;
  onClose: () => void;
  onNewChat: () => void;
  onRename: () => void;
  onRemove: () => void;
}

export function ProjectMenu({
  project,
  anchor,
  onClose,
  onNewChat,
  onRename,
  onRemove,
}: ProjectMenuProps) {
  const [page, setPage] = useState<'main' | 'confirm'>('main');
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  const mainItems = (
    <>
      <MenuItem icon={<PlusIcon />} label="New chat in project" onSelect={run(onNewChat)} />
      <MenuItem icon={<PenIcon />} label="Rename" onSelect={run(onRename)} />
      <hr />
      <MenuItem
        icon={<TrashIcon />}
        label="Remove project"
        danger
        onSelect={() => setPage('confirm')}
      />
    </>
  );

  const confirmItems = (
    <>
      <p className="ctx-note">
        Remove <b>{project.name}</b>? Its chats move to Chats. Nothing on disk is deleted.
      </p>
      <MenuItem icon={<TrashIcon />} label="Remove" danger onSelect={run(onRemove)} />
      <MenuItem label="Cancel" onSelect={onClose} />
    </>
  );

  return (
    <MenuShell
      anchor={anchor}
      label={page === 'main' ? `Options for project ${project.name}` : `Remove ${project.name}?`}
      page={page}
      onClose={onClose}
    >
      {page === 'main' ? mainItems : confirmItems}
    </MenuShell>
  );
}

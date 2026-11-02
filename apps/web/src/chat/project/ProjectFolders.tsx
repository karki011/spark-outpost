import './context-bar.css';
import { useEffect, useId, type KeyboardEvent, type ReactNode } from 'react';
import type { Project } from '@spark-outpost/contracts';
import { FolderIcon } from '../../ui/icons.tsx';
import { useTooltip } from '../../ui/Tooltip.tsx';
import { useAddFolder } from '../../projects/use-add-folder.tsx';
import type { usePopover } from '../../ui/use-popover.ts';
import { RepoMenu } from './RepoMenu.tsx';
import { onProjectMenuRequest } from './project-menu-request.ts';
import { PICK_PROJECT_HINT, recentProjects, repoSummary, type RepoChange } from './repo-list.ts';
import { useChatRepos, useProjects } from './use-chat-repos.ts';

type RepoPopover = ReturnType<typeof usePopover<HTMLButtonElement, HTMLDivElement>>;

interface ContextDetails {
  id: string;
  open: boolean;
  showProject?: boolean;
  items: ReactNode;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

interface ProjectFoldersProps {
  conversationId: string;
  repos: Project[];
  popover: RepoPopover;
  details?: ContextDetails | undefined;
  children?: ReactNode;
}

const RECENT_LIMIT = 5;

export function ProjectFolders({
  conversationId,
  repos,
  popover,
  details,
  children,
}: ProjectFoldersProps) {
  const { open, toggle, setOpen, anchorRef, panelRef } = popover;
  const projects = useProjects();
  const change = useChatRepos(conversationId);
  const menuId = useId();
  const primary = repos[0] ?? null;
  const linkedIds = new Set(repos.map((repo) => repo.id));
  const recent = recentProjects(projects.data ?? [], linkedIds, RECENT_LIMIT);
  const names = repos.map((repo) => repo.name);
  const projectTip = useTooltip(
    primary ? repos.map((repo) => repo.rootPath).join(', ') : PICK_PROJECT_HINT,
  );

  useEffect(
    () =>
      onProjectMenuRequest(conversationId, () => {
        setOpen(true);
        anchorRef.current?.focus();
      }),
    [conversationId, setOpen, anchorRef],
  );

  const apply = (request: RepoChange) => {
    change.mutate(request, {
      onSuccess: () => {
        if (request.type !== 'add') return;
        setOpen(false);
        anchorRef.current?.focus();
      },
    });
  };
  const adder = useAddFolder({
    onAdded: (project) => apply({ type: 'add', projectId: project.id }),
  });

  const startAdding = (start: () => void) => {
    change.reset();
    setOpen(false);
    anchorRef.current?.focus();
    start();
  };

  const error = change.isError ? change.error.message : null;

  const folderChip = (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={primary ? 'ctx-repo' : 'ctx-repo unset'}
        aria-label={primary ? `Project folders: ${names.join(', ')}` : 'Choose project'}
        aria-description={primary ? undefined : PICK_PROJECT_HINT}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={menuId}
        {...projectTip.triggerProps}
        onClick={() => {
          change.reset();
          toggle();
        }}
      >
        <FolderIcon />
        <span className="ctx-name">{primary ? repoSummary(names) : 'Choose project'}</span>
      </button>
      {projectTip.tooltip}
    </>
  );
  return (
    <div
      className={details ? 'ctxbar compact' : 'ctxbar'}
      role="group"
      aria-label="Project and branch"
      onKeyDown={details?.onKeyDown}
    >
      {(!details || details.showProject) && folderChip}
      {children}
      {details && (
        <div
          id={details.id}
          className="ctx-more"
          role="group"
          aria-label="Chat details"
          hidden={!details.open}
        >
          {!details.showProject && folderChip}
          {details.items}
        </div>
      )}
      <RepoMenu
        id={menuId}
        open={open}
        panelRef={panelRef}
        linked={repos}
        recent={recent}
        busy={change.isPending || adder.busy}
        error={error ?? (projects.isError ? projects.error.message : null)}
        actions={adder.actions.map((action) => ({
          ...action,
          onSelect: () => startAdding(action.onSelect),
        }))}
        onChange={apply}
      />
      {adder.flow}
    </div>
  );
}

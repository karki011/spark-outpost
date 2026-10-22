import './context-bar.css';
import { useEffect, useId, type ReactNode } from 'react';
import type { Project } from '@spark-outpost/contracts';
import { ChevronIcon, FolderIcon } from '../../ui/icons.tsx';
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
  folder: boolean;
  items: ReactNode;
}

interface ProjectFoldersProps {
  conversationId: string;
  repos: Project[];
  popover: RepoPopover;
  lead?: ReactNode;
  details?: ContextDetails | undefined;
  children?: ReactNode;
}

const RECENT_LIMIT = 5;

export function ProjectFolders({
  conversationId,
  repos,
  popover,
  lead = null,
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

  const apply = (request: RepoChange) => change.mutate(request);
  const adder = useAddFolder({
    onAdded: (project) => apply({ type: 'add', projectId: project.id }),
    onError: () => setOpen(true),
  });

  const startAdding = (start: () => void) => {
    change.reset();
    setOpen(false);
    anchorRef.current?.focus();
    start();
  };

  const error = adder.error ?? (change.isError ? change.error.message : null);

  const folderChip = (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={primary ? 'ctx-repo' : 'ctx-repo unset'}
        aria-label={primary ? `Project folders: ${names.join(', ')}` : 'Choose project'}
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
        <ChevronIcon />
      </button>
      {projectTip.tooltip}
    </>
  );
  const folderInDetails = details?.folder ?? false;

  return (
    <div className="ctxbar-wrap">
      {details ? (
        <div className="ctxbar compact">
          {lead}
          <div className="ctx-row">
            {!folderInDetails && folderChip}
            {children}
          </div>
          <div
            id={details.id}
            className="ctx-more"
            role="group"
            aria-label="Chat details"
            hidden={!details.open}
          >
            {folderInDetails && folderChip}
            {details.items}
          </div>
        </div>
      ) : (
        <div className="ctxbar">
          {lead}
          {folderChip}
          {children}
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

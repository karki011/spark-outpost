import './context-bar.css';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import type { Project } from '@spark-outpost/contracts';
import { ChevronIcon, FolderIcon } from '../../ui/icons.tsx';
import { useTooltip } from '../../ui/Tooltip.tsx';
import type { usePopover } from '../../ui/use-popover.ts';
import { FolderDialog } from './FolderDialog.tsx';
import { RepoMenu } from './RepoMenu.tsx';
import { onProjectMenuRequest } from './project-menu-request.ts';
import { PICK_PROJECT_HINT, recentProjects, repoSummary } from './repo-list.ts';
import { useChatRepos, useProjects, type RepoRequest } from './use-chat-repos.ts';

type RepoPopover = ReturnType<typeof usePopover<HTMLButtonElement, HTMLDivElement>>;

interface ProjectFoldersProps {
  conversationId: string;
  repos: Project[];
  popover: RepoPopover;
  lead?: ReactNode;
  children?: ReactNode;
}

const RECENT_LIMIT = 5;

export function ProjectFolders({
  conversationId,
  repos,
  popover,
  lead = null,
  children,
}: ProjectFoldersProps) {
  const { open, toggle, setOpen, anchorRef, panelRef } = popover;
  const [browsing, setBrowsing] = useState(false);
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

  const apply = (request: RepoRequest) => {
    change.mutate(request, {
      onSuccess: () => {
        if (browsing) {
          setBrowsing(false);
          anchorRef.current?.focus();
        }
      },
    });
  };

  const openBrowser = () => {
    change.reset();
    setOpen(false);
    setBrowsing(true);
  };

  const closeBrowser = () => {
    setBrowsing(false);
    anchorRef.current?.focus();
  };

  const error = change.isError && !browsing ? change.error.message : null;

  return (
    <div className="ctxbar-wrap">
      <div className="ctxbar">
        {lead}
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
        {children}
      </div>
      <RepoMenu
        id={menuId}
        open={open}
        panelRef={panelRef}
        linked={repos}
        recent={recent}
        busy={change.isPending}
        error={error ?? (projects.isError ? projects.error.message : null)}
        onChange={apply}
        onBrowse={openBrowser}
      />
      <AnimatePresence>
        {browsing && (
          <FolderDialog
            key="folders"
            linking={change.isPending}
            error={change.isError ? change.error.message : null}
            onUse={(rootPath) => apply({ type: 'add', rootPath })}
            onClose={closeBrowser}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

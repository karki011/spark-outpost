import './context-bar.css';
import { useId, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import type { Project } from '@spark-outpost/contracts';
import { ChevronIcon, FolderIcon } from '../../ui/icons.tsx';
import type { usePopover } from '../../ui/use-popover.ts';
import { AgentSetup } from './AgentSetup.tsx';
import { FolderDialog } from './FolderDialog.tsx';
import { RepoMenu } from './RepoMenu.tsx';
import { WorkPlaceMenu } from './WorkPlaceMenu.tsx';
import { recentProjects, repoSummary } from './repo-list.ts';
import { useChatRepos, useProjectBranch, useProjects, type RepoRequest } from './use-chat-repos.ts';

type RepoPopover = ReturnType<typeof usePopover<HTMLButtonElement, HTMLDivElement>>;

interface ContextBarProps {
  conversationId: string;
  repos: Project[];
  popover: RepoPopover;
}

const RECENT_LIMIT = 5;

export function ContextBar({ conversationId, repos, popover }: ContextBarProps) {
  const { open, toggle, setOpen, anchorRef, panelRef } = popover;
  const [browsing, setBrowsing] = useState(false);
  const projects = useProjects();
  const change = useChatRepos(conversationId);
  const menuId = useId();
  const primary = repos[0] ?? null;
  const branch = useProjectBranch(primary?.id ?? null);
  const linkedIds = new Set(repos.map((repo) => repo.id));
  const recent = recentProjects(projects.data ?? [], linkedIds, RECENT_LIMIT);
  const names = repos.map((repo) => repo.name);

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
        <button
          ref={anchorRef}
          type="button"
          className={primary ? 'ctx-repo' : 'ctx-repo unset'}
          aria-label={primary ? `Project folders: ${names.join(', ')}` : 'Choose project'}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={menuId}
          title={repos.map((repo) => repo.rootPath).join('\n') || undefined}
          onClick={() => {
            change.reset();
            toggle();
          }}
        >
          <FolderIcon />
          <span className="ctx-name">{primary ? repoSummary(names) : 'Choose project'}</span>
          <ChevronIcon />
        </button>
        {primary && (
          <WorkPlaceMenu
            conversationId={conversationId}
            projectId={primary.id}
            checkoutBranch={branch}
          />
        )}
        {primary && <AgentSetup key={primary.id} repos={repos} />}
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

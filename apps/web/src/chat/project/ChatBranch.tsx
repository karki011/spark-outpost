import './chat-branch.css';
import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PR_ROUTE_LABELS, type ChatBranch as Branch } from '@spark-outpost/contracts';
import { shipApi, shipKeys } from '../../ship/ship-api.ts';
import { BranchIcon, ChevronIcon, CopyIcon, FolderIcon } from '../../ui/icons.tsx';
import { usePopover } from '../../ui/use-popover.ts';
import { useTooltip } from '../../ui/Tooltip.tsx';
import { useRemoteClient } from '../../phone/use-remote-client.ts';
import { useCopyFeedback } from '../../ui/use-copy-feedback.ts';
import { adoptedLabel, branchTip } from './place-picker-model.ts';
import { useBringChanges, useOpenWorktree } from './use-chat-workspace.ts';

interface ChatBranchProps {
  conversationId: string;
  branch: Branch;
  checkoutBranch: string | null;
}

const ROUTE_STALE_MS = 5 * 60_000;

function usePrRouteLabel(conversationId: string): string | null {
  const route = useQuery({
    queryKey: shipKeys.prRoute(conversationId),
    queryFn: () => shipApi.prRoute(conversationId),
    staleTime: ROUTE_STALE_MS,
  });
  const info = route.data?.info;
  return info ? PR_ROUTE_LABELS[info.route] : null;
}

const BRANCH_LOCK_HINT = 'Where this chat works is set once it has a branch.';

const COPY_LABELS = {
  idle: 'Copy branch name',
  copied: 'Copied the branch name',
  failed: 'Could not copy the branch name',
} as const;

export function ChatBranch({ conversationId, branch, checkoutBranch }: ChatBranchProps) {
  const { open, setOpen, toggle, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const panelId = useId();
  const openFolder = useOpenWorktree(conversationId);
  const { remote } = useRemoteClient();
  const bring = useBringChanges(conversationId);
  const copy = useCopyFeedback();
  const routeLabel = usePrRouteLabel(conversationId);
  const tipText = routeLabel ? `${branchTip(branch)} · ${routeLabel}` : branchTip(branch);
  const tip = useTooltip(tipText, { side: 'top' });
  const kind = branch.adopted
    ? adoptedLabel(branch.adopted)
    : branch.worktree
      ? 'worktree'
      : 'my files';
  const into = checkoutBranch ?? 'my files';
  const failure = openFolder.error ?? bring.error;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="ctx-branch ctx-place chat-branch"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`This chat’s branch: ${branch.branch}, ${kind}`}
        {...tip.triggerProps}
        onClick={toggle}
      >
        <BranchIcon />
        <span className="ctx-branch-name">{branch.branch}</span>
        <span className="chat-branch-kind">· {kind}</span>
        <ChevronIcon />
      </button>
      {tip.tooltip}
      <div
        ref={panelRef}
        id={panelId}
        className={open ? 'mpop left branchpop open' : 'mpop left branchpop'}
        role="dialog"
        aria-label="This chat’s branch"
      >
        <div className="branchpop-head">
          <b title={branch.branch}>{branch.branch}</b>
          <small title={branch.path}>{branch.path}</small>
          {branch.adopted && (
            <p>
              <a href={branch.adopted.url} target="_blank" rel="noreferrer">
                Pull request #{branch.adopted.number}
              </a>{' '}
              by @{branch.adopted.author}.{' '}
              {branch.adopted.pushes
                ? 'The agent pushes to it, never force.'
                : `The agent works on its own branch based on ${branch.adopted.head}.`}
            </p>
          )}
          <p>{BRANCH_LOCK_HINT}</p>
        </div>
        {branch.worktree && !remote && (
          <button
            type="button"
            className="mopt"
            disabled={openFolder.isPending}
            onClick={() => {
              setOpen(false);
              openFolder.mutate();
            }}
          >
            <FolderIcon />
            <span>Open the worktree folder</span>
          </button>
        )}
        {branch.worktree && (
          <button
            type="button"
            className="mopt"
            disabled={bring.isPending}
            onClick={() => bring.mutate()}
          >
            <BranchIcon />
            <span>{bring.isPending ? 'Bringing…' : `Bring changes into ${into}`}</span>
          </button>
        )}
        <button type="button" className="mopt" onClick={() => copy.copy(branch.branch)}>
          <CopyIcon />
          <span>{COPY_LABELS[copy.state]}</span>
        </button>
        <p className="sr-only" role="status">
          {copy.state === 'idle' ? '' : COPY_LABELS[copy.state]}
        </p>
        {bring.data && (
          <p className="branchpop-done" role="status">
            Brought {bring.data.files.length} file{bring.data.files.length === 1 ? '' : 's'} into{' '}
            {bring.data.into ?? 'my files'}, uncommitted.
          </p>
        )}
        {failure && (
          <p className="mpop-error" role="alert">
            {failure.message}
          </p>
        )}
      </div>
    </>
  );
}

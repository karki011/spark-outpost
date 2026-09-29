import './chat-branch.css';
import type { ChatBranch as Branch } from '@spark-outpost/contracts';
import { BranchIcon, FolderIcon } from '../../ui/icons.tsx';
import { useTooltip } from '../../ui/Tooltip.tsx';
import { useOpenWorktree } from './use-chat-workspace.ts';

interface ChatBranchProps {
  conversationId: string;
  branch: Branch;
}

export function ChatBranch({ conversationId, branch }: ChatBranchProps) {
  const open = useOpenWorktree(conversationId);
  const openTip = useTooltip('Open this chat’s copy');
  const kind = branch.worktree ? 'copy' : 'my files';
  return (
    <span className="chat-branch" title={branch.path}>
      <BranchIcon />
      <span className="sr-only">Branch</span>
      <span className="chat-branch-name">{branch.branch}</span>
      <span className="chat-branch-kind">· {kind}</span>
      {branch.worktree && (
        <>
          <button
            type="button"
            className="icon-btn chat-branch-open"
            aria-label="Open this chat’s copy"
            disabled={open.isPending}
            {...openTip.triggerProps}
            onClick={() => open.mutate()}
          >
            <FolderIcon />
          </button>
          {openTip.tooltip}
        </>
      )}
      {open.isError && (
        <span className="sr-only" role="alert">
          {open.error.message}
        </span>
      )}
    </span>
  );
}

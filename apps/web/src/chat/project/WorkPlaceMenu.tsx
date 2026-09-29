import { useId } from 'react';
import type { ChatWorkspace, UpdateChatWorkspaceRequest } from '@spark-outpost/contracts';
import { BranchIcon, ChevronIcon, FolderIcon, TickIcon } from '../../ui/icons.tsx';
import { usePopover } from '../../ui/use-popover.ts';
import { useChatWorkspace, useProjectBranches, useUpdateWorkspace } from './use-chat-workspace.ts';

const BRANCHES_SHOWN = 30;

interface WorkPlaceMenuProps {
  conversationId: string;
  projectId: string;
  checkoutBranch: string | null;
}

function placeLabel(workspace: ChatWorkspace, checkoutBranch: string | null): string {
  if (workspace.requestedBranch) return `${workspace.requestedBranch} · worktree`;
  if (workspace.place === 'checkout') return `${checkoutBranch ?? 'Checkout'} · your checkout`;
  return 'New branch · worktree';
}

function Option({
  checked,
  title,
  detail,
  busy,
  onPick,
}: {
  checked: boolean;
  title: string;
  detail?: string;
  busy: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      className="mopt"
      aria-checked={checked}
      disabled={busy}
      onClick={onPick}
    >
      <span>
        <b>{title}</b>
        {detail && <small>{detail}</small>}
      </span>
      <TickIcon />
    </button>
  );
}

export function WorkPlaceMenu({ conversationId, projectId, checkoutBranch }: WorkPlaceMenuProps) {
  const { open, toggle, setOpen, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const menuId = useId();
  const workspace = useChatWorkspace(conversationId);
  const branches = useProjectBranches(projectId, open);
  const update = useUpdateWorkspace(conversationId);
  const data = workspace.data;
  if (!data) return null;
  if (data.current) return null;
  if (!checkoutBranch && data.place === 'worktree' && !data.requestedBranch) return null;

  const pick = (body: UpdateChatWorkspaceRequest) => {
    update.mutate(body, {
      onSuccess: () => {
        setOpen(false);
        anchorRef.current?.focus();
      },
    });
  };
  const fresh = data.place === 'worktree' && !data.requestedBranch;
  const inCheckout = data.place === 'checkout' && !data.requestedBranch;
  const existing = [...(branches.data?.local ?? []), ...(branches.data?.remote ?? [])].slice(
    0,
    BRANCHES_SHOWN,
  );
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="ctx-branch ctx-place"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Where this chat works: ${placeLabel(data, checkoutBranch)}`}
        onClick={() => {
          update.reset();
          toggle();
        }}
      >
        {inCheckout ? <FolderIcon /> : <BranchIcon />}
        <span className="ctx-branch-name">{placeLabel(data, checkoutBranch)}</span>
        <ChevronIcon />
      </button>
      <div
        ref={panelRef}
        id={menuId}
        className={open ? 'mpop left placepop open' : 'mpop left placepop'}
        role="menu"
        aria-label="Where this chat works"
      >
        <Option
          checked={fresh}
          title="New branch in a worktree"
          detail="Your checkout stays as it is"
          busy={update.isPending}
          onPick={() => pick({ place: 'worktree', branch: null })}
        />
        <Option
          checked={inCheckout}
          title="Work in my checkout"
          detail={checkoutBranch ? `Edits land on ${checkoutBranch}` : 'Edits land in your folder'}
          busy={update.isPending}
          onPick={() => pick({ place: 'checkout', branch: null })}
        />
        {existing.length > 0 && <div className="mgroup">Work on an existing branch</div>}
        {existing.map((branch) => (
          <Option
            key={branch}
            checked={data.requestedBranch === branch}
            title={branch}
            {...(branch === checkoutBranch ? { detail: 'Checked out in your folder' } : {})}
            busy={update.isPending}
            onPick={() => pick({ branch })}
          />
        ))}
        {update.isError && (
          <p className="mpop-error" role="alert">
            {update.error.message}
          </p>
        )}
        <p className="eff-note">
          Worktree or checkout is remembered for this project. A chat keeps its branch once it
          starts changing files.
        </p>
      </div>
    </>
  );
}

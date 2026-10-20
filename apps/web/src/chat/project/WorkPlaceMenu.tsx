import './place-picker.css';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { UpdateChatWorkspaceRequest } from '@spark-outpost/contracts';
import { BranchIcon, ChevronIcon, FolderIcon, PlusIcon, TickIcon } from '../../ui/icons.tsx';
import { Blobatar } from 'blobatar/react';
import * as expressions from 'blobatar/expression';
import { BlobScout } from '../../brand/BlobScout.tsx';
import { usePopover } from '../../ui/use-popover.ts';
import { branchRows, placeLabel } from './place-picker-model.ts';
import {
  useChatWorkspace,
  useFetchBranches,
  useProjectBranches,
  useUpdateWorkspace,
} from './use-chat-workspace.ts';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import { AdoptPullList } from './AdoptPullList.tsx';

interface WorkPlaceMenuProps {
  conversationId: string;
  projectId: string;
  checkoutBranch: string | null;
}

function focusRow(list: HTMLElement | null, from: Element | null, step: 1 | -1) {
  const rows = [...(list?.querySelectorAll<HTMLButtonElement>('.pp-row') ?? [])];
  if (rows.length === 0) return;
  const index = from ? rows.indexOf(from as HTMLButtonElement) : -1;
  rows[Math.max(0, Math.min(rows.length - 1, index + step))]?.focus();
}

export function WorkPlaceMenu({ conversationId, projectId, checkoutBranch }: WorkPlaceMenuProps) {
  const { open, toggle, anchorRef, panelRef } = usePopover<HTMLButtonElement, HTMLDivElement>();
  const panelId = useId();
  const searchId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const workspace = useChatWorkspace(conversationId);
  const branches = useProjectBranches(projectId, open);
  const refresh = useFetchBranches(projectId);
  const update = useUpdateWorkspace(conversationId);
  const data = workspace.data;
  if (!data) return null;
  if (data.current) return null;
  if (!checkoutBranch && data.place === 'worktree' && !data.requestedBranch) return null;

  const pick = (body: UpdateChatWorkspaceRequest) => {
    update.mutate(body);
  };
  const fresh = data.place === 'worktree' && !data.requestedBranch;
  const inCheckout = data.place === 'checkout' && !data.requestedBranch;
  const list = branches.data;
  const rows = list ? branchRows(list, query, checkoutBranch) : [];
  const total = list ? list.local.length + list.remote.length : 0;
  const busy = update.isPending;
  const placeKey =
    data.requestedBranch ?? (inCheckout ? (checkoutBranch ?? 'my files') : 'new branch');

  const onListKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const fromSearch = (event.target as HTMLElement).id === searchId;
    focusRow(
      listRef.current,
      fromSearch ? null : document.activeElement,
      event.key === 'ArrowDown' ? 1 : -1,
    );
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="ctx-branch ctx-place"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Where this chat works: ${placeLabel(data, checkoutBranch)}`}
        onClick={() => {
          update.reset();
          setQuery('');
          toggle();
        }}
      >
        {inCheckout ? <FolderIcon /> : <BranchIcon />}
        <span className="ctx-branch-name">{placeLabel(data, checkoutBranch)}</span>
        <ChevronIcon />
      </button>
      <div
        ref={panelRef}
        id={panelId}
        className={open ? 'mpop left picker placepicker open' : 'mpop left picker placepicker'}
        role="dialog"
        aria-label="Where this chat works"
      >
        <div className="picker-top">
          <span className="picker-title">
            Branch
            <small>Works in a git worktree, so your files stay put.</small>
          </span>
          <span className="pp-blob" aria-hidden="true">
            <span key={placeKey} className={busy ? 'pp-swap busy' : 'pp-swap'}>
              <Blobatar
                name={`place:${placeKey}`}
                size={26}
                animate="always"
                expression={busy ? expressions.thinking : expressions.happy}
              />
            </span>
          </span>
          <span className="sr-only" role="status">
            {busy ? 'Switching…' : ''}
          </span>
        </div>
        <button
          type="button"
          className="pp-new"
          aria-pressed={fresh}
          disabled={busy}
          onClick={() => pick({ place: 'worktree', branch: null })}
        >
          <span className="pp-new-icon" aria-hidden="true">
            <PlusIcon />
          </span>
          <span className="pp-new-text">
            <b>New branch{checkoutBranch ? ` from ${checkoutBranch}` : ''}</b>
            <small>
              New worktree. Spark names the branch from your first message, like
              spark/fix-login-3f9a
            </small>
          </span>
          <TickIcon />
        </button>
        <div className="pp-branches">
          <div className="pp-head">
            <span>Or continue a branch</span>
            {list?.hasRemote && (
              <button
                type="button"
                className="pp-fetch"
                disabled={refresh.isPending}
                onClick={() => refresh.mutate()}
              >
                Fetch
              </button>
            )}
          </div>
          {total > 6 && (
            <>
              <label htmlFor={searchId} className="sr-only">
                Find a branch
              </label>
              <input
                id={searchId}
                type="search"
                className="inp pp-search"
                placeholder="Find a branch"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onListKey}
              />
            </>
          )}
          <div
            ref={listRef}
            className="pp-list"
            role="radiogroup"
            aria-label="Existing branches"
            onKeyDown={onListKey}
          >
            {refresh.isPending && (
              <p className="pp-pulling" role="status">
                <span className="pp-tug">
                  <BlobScout size={22} mood="working" />
                </span>
                <i className="pp-rope" aria-hidden="true" />
                Pulling branches from the remote…
              </p>
            )}
            {branches.isPending && <Skeleton label="Reading branches" shape="list" rows={4} />}
            {list && total > 0 && rows.length === 0 && (
              <p className="mempty">No branch matches “{query.trim()}”.</p>
            )}
            {rows.map((row) => (
              <button
                key={`${row.remote ? 'r' : 'l'}:${row.name}`}
                type="button"
                role="radio"
                className="pp-row"
                aria-checked={data.requestedBranch === row.name}
                disabled={busy}
                onClick={() => pick({ branch: row.name })}
              >
                <span className="pp-row-blob" aria-hidden="true">
                  {data.requestedBranch === row.name ? (
                    <Blobatar name={`place:${row.name}`} size={20} animate="always" />
                  ) : (
                    <BranchIcon />
                  )}
                </span>
                <span className="pp-name" title={row.name}>
                  {row.name}
                </span>
                {row.tags.map((tag) => (
                  <span key={tag} className="mtag">
                    {tag}
                  </span>
                ))}
                <TickIcon />
              </button>
            ))}
          </div>
          {(refresh.data?.fetchFailed || refresh.isError) && (
            <p className="mpop-error" role="alert">
              Couldn’t reach the remote. Showing the branches this repo already knows.
            </p>
          )}
        </div>
        {update.isError && (
          <p className="mpop-error" role="alert">
            {update.error.message}
          </p>
        )}
        <AdoptPullList conversationId={conversationId} projectId={projectId} />
        <div className="pp-foot">
          <button
            type="button"
            className="pp-direct"
            aria-pressed={inCheckout}
            disabled={busy}
            onClick={() =>
              pick(
                inCheckout
                  ? { place: 'worktree', branch: null }
                  : { place: 'checkout', branch: null },
              )
            }
          >
            <FolderIcon />
            <span>
              {inCheckout
                ? `Editing your files directly${checkoutBranch ? ` on ${checkoutBranch}` : ''}`
                : 'Edit my files directly instead'}
            </span>
            <TickIcon />
          </button>
          <p>A chat keeps its branch once it starts changing files.</p>
        </div>
      </div>
    </>
  );
}

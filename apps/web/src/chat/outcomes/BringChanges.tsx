import './bring-changes.css';
import { useEffect, useRef } from 'react';
import type { BringChangesResult } from '@spark-outpost/contracts';
import { useProjectBranch } from '../project/use-chat-repos.ts';
import { useBringChanges, useChatWorkspace } from '../project/use-chat-workspace.ts';

function broughtLine(result: BringChangesResult): string {
  const count = result.files.length;
  const files = `${count} file${count === 1 ? '' : 's'}`;
  const into = result.into ?? 'your checkout';
  return `Brought ${files} into ${into}. They're uncommitted, ready for you to review and commit.`;
}

export function BringChanges({ conversationId }: { conversationId: string }) {
  const workspace = useChatWorkspace(conversationId);
  const current = workspace.data?.current ?? null;
  const checkout = useProjectBranch(current?.worktree ? current.projectId : null);
  const bring = useBringChanges(conversationId);
  const doneRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (bring.isSuccess) doneRef.current?.focus();
  }, [bring.isSuccess]);

  if (!current?.worktree) return null;
  const into = checkout ?? 'your checkout';
  return (
    <div className="bring">
      <p className="bring-where">
        Kept on <code>{current.branch}</code> in this chat&rsquo;s worktree.
      </p>
      {bring.data ? (
        <p ref={doneRef} className="bring-done" role="status" tabIndex={-1}>
          {broughtLine(bring.data)}
        </p>
      ) : (
        <button
          type="button"
          className="btn line sm"
          disabled={bring.isPending}
          onClick={() => bring.mutate()}
        >
          {bring.isPending ? 'Bringing…' : `Bring changes into ${into}`}
        </button>
      )}
      {bring.isError && (
        <p className="bring-err" role="alert">
          {bring.error.message}
        </p>
      )}
    </div>
  );
}

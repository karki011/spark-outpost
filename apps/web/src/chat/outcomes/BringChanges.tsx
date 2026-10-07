import './bring-changes.css';
import { useEffect, useRef } from 'react';
import type { BringChangesResult } from '@spark-outpost/contracts';
import {
  useBringChanges,
  useBringReadiness,
  useChatWorkspace,
} from '../project/use-chat-workspace.ts';

function broughtLine(result: BringChangesResult): string {
  const count = result.files.length;
  const files = `${count} file${count === 1 ? '' : 's'}`;
  const into = result.into ?? 'my files';
  return `Brought ${files} into ${into}. They're uncommitted, ready for you to review and commit.`;
}

export function BringChanges({ conversationId }: { conversationId: string }) {
  const workspace = useChatWorkspace(conversationId);
  const current = workspace.data?.current ?? null;
  const readiness = useBringReadiness(conversationId);
  const bring = useBringChanges(conversationId);
  const doneRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (bring.isSuccess) doneRef.current?.focus();
  }, [bring.isSuccess]);

  if (!current?.worktree) return null;
  const offered = readiness.data?.ready === true && !bring.data;
  const into = readiness.data?.into ?? 'my files';
  return (
    <div className="bring">
      <p className="bring-where">
        In this chat&rsquo;s worktree.
        {offered && (
          <>
            {' '}
            <button
              type="button"
              className="bring-link"
              disabled={bring.isPending}
              onClick={() => bring.mutate()}
            >
              {bring.isPending ? 'Bringing…' : `Bring changes into ${into}`}
            </button>
          </>
        )}
      </p>
      {bring.data && (
        <p ref={doneRef} className="bring-done" role="status" tabIndex={-1}>
          {broughtLine(bring.data)}
        </p>
      )}
      {bring.isError && (
        <p className="bring-err" role="alert">
          {bring.error.message}
        </p>
      )}
    </div>
  );
}

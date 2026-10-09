import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import type { MemberRequest, Outpost } from '@spark-outpost/contracts';
import { OutpostSeamContext } from '../chat/outpost/outpost-seam.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { useAddMember, useOutposts } from './use-outposts.ts';

const OutpostCreate = lazy(() =>
  import('./OutpostCreate.tsx').then((module) => ({ default: module.OutpostCreate })),
);

const NO_OUTPOSTS: readonly Outpost[] = [];

interface Creating {
  firstChatId: string | null;
  draftId: string | null;
}

interface OutpostHostProps {
  openOutpostId: string | null;
  onOpenOutpost: (outpostId: string, postId?: string) => void;
  children: ReactNode;
}

export function OutpostHost({ openOutpostId, onOpenOutpost, children }: OutpostHostProps) {
  const outposts = useOutposts().data ?? NO_OUTPOSTS;
  const addMember = useAddMember().mutateAsync;
  const { remote } = useRemoteClient();
  const [creating, setCreating] = useState<Creating | null>(null);
  const openOutpost = (outpostId: string) => {
    setCreating(null);
    onOpenOutpost(outpostId);
  };
  const seam = useMemo(
    () => ({
      outposts,
      openOutpostId,
      canManage: !remote,
      onOpenOutpost,
      onNewOutpost: (conversationId?: string) =>
        setCreating({ firstChatId: conversationId ?? null, draftId: null }),
      onOpenDraft: (draftId: string) => setCreating({ firstChatId: null, draftId }),
      onAddToOutpost: (outpostId: string, member: MemberRequest) =>
        addMember({ outpostId, member }),
    }),
    [outposts, openOutpostId, remote, onOpenOutpost, addMember],
  );
  return (
    <OutpostSeamContext value={seam}>
      {children}
      {creating && (
        <Suspense fallback={null}>
          <OutpostCreate
            firstChatId={creating.firstChatId}
            draftId={creating.draftId}
            onCreated={openOutpost}
            onClose={() => setCreating(null)}
          />
        </Suspense>
      )}
    </OutpostSeamContext>
  );
}
